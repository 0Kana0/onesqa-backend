"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");

let _clientPromise = null;

async function getOpenAI() {
  if (!_clientPromise) {
    _clientPromise = (async () => {
      const mod = await import("openai");
      const OpenAI = mod.default || mod;
      return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    })();
  }
  return _clientPromise;
}

// --------------------
// Responses API -> text helpers
// --------------------
function getRespText(resp) {
  if (!resp) return "";
  if (typeof resp.output_text === "string") return resp.output_text.trim();

  const out = Array.isArray(resp.output) ? resp.output : [];
  const texts = [];
  for (const item of out) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c?.type === "output_text" && typeof c.text === "string") texts.push(c.text);
      }
    }
  }
  return texts.join("\n").trim();
}

// --------------------
// Normalize historyList:
// - assistant "output_text" -> "input_text" (เราเอามาเป็น context)
// - keep input_file / input_image blocks 그대로
// --------------------
function normalizeHistoryForInput(historyList) {
  const list = Array.isArray(historyList) ? historyList : [];

  return list.map((m) => {
    const role = m?.role || "user";
    const content = Array.isArray(m?.content) ? m.content : [];

    const normContent = content.map((b) => {
      if (b?.type === "output_text") {
        return { type: "input_text", text: String(b.text ?? "") };
      }
      return b;
    });

    return { role, content: normContent };
  });
}

// --------------------
// Excel payload normalizers (เหมือนของคุณ)
// --------------------
function unionKeys(rows) {
  const set = new Set();
  for (const r of rows) {
    if (r && typeof r === "object" && !Array.isArray(r)) {
      Object.keys(r).forEach((k) => set.add(k));
    }
  }
  return Array.from(set);
}

function coerceExcelPayload(payload) {
  const tryParseString = (s) => {
    if (typeof s !== "string") return null;
    const t = s.trim();
    if (!t) return null;

    const looksJson =
      (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
    if (!looksJson) return null;

    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  };

  if (typeof payload === "string") {
    const parsed = tryParseString(payload);
    if (parsed != null) return coerceExcelPayload(parsed);
    return [{ value: payload }];
  }

  if (typeof payload === "number" || typeof payload === "boolean") {
    return [{ value: payload }];
  }

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    for (const k of ["json", "payload", "content", "text", "data", "items", "result", "output"]) {
      if (typeof payload[k] === "string") {
        const parsed = tryParseString(payload[k]);
        if (parsed != null) return coerceExcelPayload(parsed);
      }
    }
  }

  return payload;
}

function normalizeToSheets(payload, defaultSheetName = "Sheet1") {
  const unwrap = (x) => {
    if (!x || typeof x !== "object") return x;
    for (const k of ["payload", "data", "items", "result", "output", "table"]) {
      if (k in x) return x[k];
    }
    return x;
  };

  payload = unwrap(payload);

  if (payload == null) {
    return [{ name: defaultSheetName, headers: [], rows: [], rowMode: "object" }];
  }

  if (Array.isArray(payload)) {
    const rows = payload;

    const hasObject = rows.some((r) => r && typeof r === "object" && !Array.isArray(r));
    const hasArray = rows.some((r) => Array.isArray(r));

    if (hasObject) {
      const headers = unionKeys(rows.filter((r) => r && typeof r === "object" && !Array.isArray(r)));
      return [{ name: defaultSheetName, headers, rows, rowMode: "object" }];
    }

    if (hasArray) {
      const colCount = Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0)), 0);
      const headers = Array.from({ length: colCount }, (_, i) => `col_${i + 1}`);
      return [{ name: defaultSheetName, headers, rows, rowMode: "array" }];
    }

    const objRows = rows.map((v) => ({ value: v }));
    return [{ name: defaultSheetName, headers: ["value"], rows: objRows, rowMode: "object" }];
  }

  if (payload && typeof payload === "object") {
    payload = unwrap(payload);

    if (Array.isArray(payload.rows)) {
      const name = payload.sheetName || defaultSheetName;
      const rows = payload.rows;

      const isObjectRows = rows.some((r) => r && typeof r === "object" && !Array.isArray(r));
      const isArrayRows = rows.some((r) => Array.isArray(r));

      if (isObjectRows) {
        const headers = Array.isArray(payload.columns) ? payload.columns : unionKeys(rows);
        return [{ name, headers, rows, rowMode: "object" }];
      }
      if (isArrayRows) {
        const colCount = Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0)), 0);
        const headers = Array.isArray(payload.columns)
          ? payload.columns
          : Array.from({ length: colCount }, (_, i) => `col_${i + 1}`);
        return [{ name, headers, rows, rowMode: "array" }];
      }

      return [{ name, headers: Array.isArray(payload.columns) ? payload.columns : [], rows: [], rowMode: "object" }];
    }

    if (Array.isArray(payload.sheets)) {
      return payload.sheets.map((s, idx) => {
        const name = s?.name || `Sheet${idx + 1}`;
        const rows = Array.isArray(s?.rows) ? s.rows : [];

        const isObjectRows = rows.some((r) => r && typeof r === "object" && !Array.isArray(r));
        const isArrayRows = rows.some((r) => Array.isArray(r));

        if (isObjectRows) {
          const headers = Array.isArray(s?.columns) ? s.columns : unionKeys(rows);
          return { name, headers, rows, rowMode: "object" };
        }
        if (isArrayRows) {
          const colCount = Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0)), 0);
          const headers = Array.isArray(s?.columns)
            ? s.columns
            : Array.from({ length: colCount }, (_, i) => `col_${i + 1}`);
          return { name, headers, rows, rowMode: "array" };
        }

        return { name, headers: Array.isArray(s?.columns) ? s.columns : [], rows: [], rowMode: "object" };
      });
    }

    const keys = Object.keys(payload);
    const looksLikeSheetMap =
      keys.length > 0 &&
      keys.every((k) => {
        const v = payload[k];
        return Array.isArray(v) || (v && typeof v === "object" && Array.isArray(v.rows));
      });

    if (looksLikeSheetMap) {
      const sheets = [];
      for (const k of keys) {
        const v = unwrap(payload[k]);
        if (Array.isArray(v)) {
          sheets.push(...normalizeToSheets(v, k).map((s) => ({ ...s, name: k })));
        } else if (v && typeof v === "object" && Array.isArray(v.rows)) {
          sheets.push(...normalizeToSheets({ ...v, sheetName: k }, k));
        }
      }
      return sheets.length
        ? sheets
        : [{ name: defaultSheetName, headers: [], rows: [], rowMode: "object" }];
    }

    return [{ name: defaultSheetName, headers: unionKeys([payload]), rows: [payload], rowMode: "object" }];
  }

  throw new Error("Invalid JSON shape for Excel (payload type unsupported).");
}

// --------------------
// usage merge (OpenAI)
// --------------------
function normalizeUsage(u) {
  if (!u) return null;
  return {
    input_tokens: Number(u.input_tokens || 0),
    output_tokens: Number(u.output_tokens || 0),
    total_tokens: Number(u.total_tokens || (Number(u.input_tokens || 0) + Number(u.output_tokens || 0))),
  };
}

function sumUsage(usages) {
  const out = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  for (const u0 of usages) {
    const u = normalizeUsage(u0);
    if (!u) continue;
    out.input_tokens += u.input_tokens;
    out.output_tokens += u.output_tokens;
    out.total_tokens += u.total_tokens;
  }
  return out;
}

// --------------------
// Step2 strict JSON via json_schema
// --------------------
function buildExcelPayloadSchema() {
  const CellValue = {
    anyOf: [
      { type: "string" },
      { type: "number" },
      { type: "integer" },
      { type: "boolean" },
      { type: "null" },
    ],
  };

  const RowObject = { type: "object", additionalProperties: CellValue };
  const RowAny = { anyOf: [RowObject, { type: "array", items: CellValue }] };

  return {
    type: "object",
    additionalProperties: false,
    required: ["payload"],
    properties: {
      payload: {
        anyOf: [
          { type: "array", items: RowObject },
          {
            type: "object",
            additionalProperties: true,
            properties: {
              sheetName: { type: "string" },
              columns: { type: "array", items: { type: "string" } },
              rows: { type: "array", items: RowAny },
            },
          },
          {
            type: "object",
            additionalProperties: true,
            properties: {
              sheets: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: true,
                  properties: {
                    name: { type: "string" },
                    columns: { type: "array", items: { type: "string" } },
                    rows: { type: "array", items: RowAny },
                  },
                },
              },
            },
          },
          { type: "object", additionalProperties: true },
        ],
      },
    },
  };
}

async function forceStrictJsonOpenAI(client, model, rawText, extraInstruction = "") {
  const schema = buildExcelPayloadSchema();

  const instruction =
    "Convert the following content to JSON for creating an Excel file.\n" +
    "Return ONLY JSON that matches the schema. No markdown, no explanation.\n" +
    (extraInstruction ? `\nExtra instruction:\n${extraInstruction}\n` : "") +
    "\nCONTENT:\n" +
    rawText;

  const resp = await client.responses.create({
    model,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: instruction }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "excel_payload",
        strict: true,
        schema,
      },
    },
  });

  const jsonText = getRespText(resp);
  let payloadObj;
  try {
    payloadObj = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Strict JSON step returned invalid JSON: ${e.message}\nReturned:\n${jsonText}`);
  }

  return { payload: payloadObj, jsonText, response: resp };
}

function appendJsonInstructionToLastUser(historyInput, sheetName) {
  const list = Array.isArray(historyInput) ? historyInput : [];
  if (!list.length) return list;

  // หา message user ล่าสุด
  let idx = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === "user") { idx = i; break; }
  }
  if (idx === -1) return list;

  const cloned = list.map((m) => ({ ...m, content: Array.isArray(m.content) ? [...m.content] : [] }));

  cloned[idx].content.push({
    type: "input_text",
    text:
      "IMPORTANT: Return ONLY JSON (no markdown, no explanation). " +
      "Output should represent a table for Excel. You may use one of these shapes:\n" +
      '1) [{"colA":"...","colB":123}]\n' +
      `2) {"sheetName":"${sheetName}","rows":[{"colA":"..."}]}\n` +
      `3) {"sheets":[{"name":"${sheetName}","rows":[{"colA":"..."}]}]}\n` +
      '4) {"Sheet1":[...], "Sheet2":[...]}',
  });

  return cloned;
}

/**
 * ✅ ใช้แค่ historyList เหมือน openaiGenerateImage
 */
exports.openaiGenerateExcel = async (
  historyList,
  {
    model = "gpt-5",
    outDir = "./uploads",
    fileBase = "report",
    sheetName = "Sheet1",
    enableWebSearch = true,
    jsonInstruction = true,
    debug = false,
  } = {}
) => {
  const client = await getOpenAI();
  fs.mkdirSync(outDir, { recursive: true });

  // normalize assistant output_text -> input_text
  let inputHistory = normalizeHistoryForInput(historyList);

  // เติมคำสั่ง JSON ลงท้าย user ล่าสุด (ไม่แก้ historyList ต้นฉบับ)
  if (jsonInstruction) {
    inputHistory = appendJsonInstructionToLastUser(inputHistory, sheetName);
  }

  // Step 1: web_search (ถ้าเปิด)
  const respSearch = await client.responses.create({
    model,
    input: inputHistory,
    ...(enableWebSearch ? { tools: [{ type: "web_search" }] } : {}),
  });

  const rawText = getRespText(respSearch);

  let payload = null;
  let jsonTextUsed = rawText;
  let respJson = null;

  // ลอง parse รอบแรก
  try {
    payload = JSON.parse(rawText);
    payload = coerceExcelPayload(payload);
  } catch (_) {
    // Step 2: strict json_schema
    const strict = await forceStrictJsonOpenAI(
      client,
      model,
      rawText,
      "Make JSON represent tabular data for Excel. Keep cells as string/number/boolean/null when possible."
    );

    payload = coerceExcelPayload(strict.payload); // {payload: ...} / wrapper อื่น ๆ จะถูก unwrap ใน normalizeToSheets
    jsonTextUsed = strict.jsonText;
    respJson = strict.response;
  }

  if (debug) {
    console.log("rawText preview:", String(rawText).slice(0, 800));
    console.log("jsonTextUsed preview:", String(jsonTextUsed).slice(0, 800));
    console.log("payload typeof:", typeof payload, "isArray:", Array.isArray(payload));
  }

  // สร้าง sheets
  const sheets = normalizeToSheets(payload, sheetName);

  const wb = new ExcelJS.Workbook();
  wb.creator = "ONESQA";
  wb.created = new Date();

  for (const s of sheets) {
    const ws = wb.addWorksheet(String(s.name || "Sheet"));

    ws.columns = (s.headers || []).map((h) => ({ header: String(h), key: String(h) }));
    ws.views = [{ state: "frozen", ySplit: 1 }];

    if (s.rowMode === "array") {
      const headers = s.headers || [];
      const objRows = (s.rows || []).map((arr) => {
        const o = {};
        headers.forEach((h, i) => (o[h] = Array.isArray(arr) ? arr[i] : null));
        return o;
      });
      ws.addRows(objRows);
    } else {
      ws.addRows(s.rows || []);
    }

    ws.getRow(1).font = { bold: true };
  }

  const outPath = path.join(outDir, `${fileBase}.xlsx`);
  await wb.xlsx.writeFile(outPath);

  // รวม token usage step1 + step2
  const mergedUsage = sumUsage([respSearch?.usage, respJson?.usage]);

  return {
    files: [outPath],
    text: jsonTextUsed,
    rawText,
    response: {
      search: respSearch,
      json: respJson,
      usage: mergedUsage, // { input_tokens, output_tokens, total_tokens }
    },
  };
};
