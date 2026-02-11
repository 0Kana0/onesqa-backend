"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");

let _aiPromise = null;

async function getAI() {
  if (!_aiPromise) {
    _aiPromise = (async () => {
      const { GoogleGenAI } = await import("@google/genai");
      return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    })();
  }
  return _aiPromise;
}

// fallback สำหรับบาง response shape (เผื่อไม่ได้มี resp.text)
function extractTextFromResp(resp) {
  const parts = resp?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => typeof p?.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();
  return { parts, text };
}

function getRespText(resp) {
  if (resp && typeof resp.text === "string") return resp.text.trim();
  return extractTextFromResp(resp).text;
}

// รวม keys ของ object rows ให้เป็น headers
function unionKeys(rows) {
  const set = new Set();
  for (const r of rows) {
    if (r && typeof r === "object" && !Array.isArray(r)) {
      Object.keys(r).forEach((k) => set.add(k));
    }
  }
  return Array.from(set);
}

/**
 * ✅ แก้ payload แปลกๆ ที่โมเดลชอบส่งมา:
 * - JSON ซ้อนเป็น string: '"[{"a":1}]"'
 * - wrapper: { data: "...json..." } / { result: "...json..." }
 * - primitive -> ทำเป็นคอลัมน์เดียว value
 */
function coerceExcelPayload(payload) {
  const tryParseString = (s) => {
    if (typeof s !== "string") return null;
    const t = s.trim();
    if (!t) return null;

    // เฉพาะที่ดูเหมือน JSON เท่านั้น
    const looksJson =
      (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
    if (!looksJson) return null;

    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  };

  // 1) ถ้าเป็น string ที่ข้างในเป็น JSON -> parse ซ้ำ
  if (typeof payload === "string") {
    const parsed = tryParseString(payload);
    if (parsed != null) return coerceExcelPayload(parsed);
    return [{ value: payload }];
  }

  // 2) primitive อื่นๆ
  if (typeof payload === "number" || typeof payload === "boolean") {
    return [{ value: payload }];
  }

  // 3) object ที่มี field เก็บ JSON เป็น string (เจอบ่อย)
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

// แปลง payload ให้เป็นรูปแบบ sheets
function normalizeToSheets(payload, defaultSheetName = "Sheet1") {
  // Helper: unwrap common wrappers
  const unwrap = (x) => {
    if (!x || typeof x !== "object") return x;
    for (const k of ["data", "items", "result", "output", "table"]) {
      if (k in x) return x[k];
    }
    return x;
  };

  payload = unwrap(payload);

  // 0) null/undefined
  if (payload == null) {
    return [{ name: defaultSheetName, headers: [], rows: [], rowMode: "object" }];
  }

  // 1) Array => sheet เดียว (object rows / array rows / primitive rows)
  if (Array.isArray(payload)) {
    const rows = payload;

    const hasObject = rows.some((r) => r && typeof r === "object" && !Array.isArray(r));
    const hasArray = rows.some((r) => Array.isArray(r));

    // 1.1) Array<object>
    if (hasObject) {
      const headers = unionKeys(
        rows.filter((r) => r && typeof r === "object" && !Array.isArray(r))
      );
      return [{ name: defaultSheetName, headers, rows, rowMode: "object" }];
    }

    // 1.2) Array<array>
    if (hasArray) {
      const colCount = Math.max(
        ...rows.map((r) => (Array.isArray(r) ? r.length : 0)),
        0
      );
      const headers = Array.from({ length: colCount }, (_, i) => `col_${i + 1}`);
      return [{ name: defaultSheetName, headers, rows, rowMode: "array" }];
    }

    // 1.3) Array<primitive> => ทำเป็นคอลัมน์เดียว "value"
    const objRows = rows.map((v) => ({ value: v }));
    return [{ name: defaultSheetName, headers: ["value"], rows: objRows, rowMode: "object" }];
  }

  // payload เป็น object
  if (payload && typeof payload === "object") {
    payload = unwrap(payload);

    // 2) { rows, columns?, sheetName? }
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
        const colCount = Math.max(
          ...rows.map((r) => (Array.isArray(r) ? r.length : 0)),
          0
        );
        const headers = Array.isArray(payload.columns)
          ? payload.columns
          : Array.from({ length: colCount }, (_, i) => `col_${i + 1}`);
        return [{ name, headers, rows, rowMode: "array" }];
      }

      return [{ name, headers: Array.isArray(payload.columns) ? payload.columns : [], rows: [], rowMode: "object" }];
    }

    // 3) { sheets: [...] }
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
          const colCount = Math.max(
            ...rows.map((r) => (Array.isArray(r) ? r.length : 0)),
            0
          );
          const headers = Array.isArray(s?.columns)
            ? s.columns
            : Array.from({ length: colCount }, (_, i) => `col_${i + 1}`);
          return { name, headers, rows, rowMode: "array" };
        }

        return { name, headers: Array.isArray(s?.columns) ? s.columns : [], rows: [], rowMode: "object" };
      });
    }

    // 4) รองรับ “map เป็นหลายชีท” เช่น { Sheet1:[...], Sheet2:[...] }
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
      return sheets.length ? sheets : [{ name: defaultSheetName, headers: [], rows: [], rowMode: "object" }];
    }

    // 5) object แถวเดียว => ทำเป็น 1 row
    return [{ name: defaultSheetName, headers: unionKeys([payload]), rows: [payload], rowMode: "object" }];
  }

  throw new Error("Invalid JSON shape for Excel (payload type unsupported).");
}

/**
 * รอบที่ 2: บังคับ strict JSON mode (ห้ามมี tools)
 */
async function forceStrictJson(ai, model, rawText, extraInstruction = "") {
  const resp = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Convert the following content to ONLY valid JSON. " +
              "No markdown, no explanation. Output JSON only.\n" +
              (extraInstruction ? `\nExtra instruction:\n${extraInstruction}\n` : "") +
              "\nCONTENT:\n" +
              rawText,
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
    },
  });

  const jsonText = getRespText(resp);
  let payload;
  try {
    payload = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(
      "Strict JSON step still returned invalid JSON. " +
        `JSON parse error: ${e.message}\n` +
        `Returned text:\n${jsonText}`
    );
  }

  return { payload, jsonText, response: resp };
}

// --------------------
// ✅ รวม usageMetadata (search + json)
// --------------------
function pickUsage(resp) {
  return resp?.usageMetadata || resp?.response?.usageMetadata || null;
}

function normalizeUsage(u) {
  if (!u) return null;

  const prompt = u.promptTokenCount ?? 0;
  const cand = u.candidatesTokenCount ?? 0;
  const thoughts = u.thoughtsTokenCount ?? 0;
  const tool = u.toolUsePromptTokenCount ?? 0;
  const total = u.totalTokenCount ?? (prompt + cand + thoughts + tool);

  return {
    promptTokenCount: prompt,
    candidatesTokenCount: cand,
    thoughtsTokenCount: thoughts,
    toolUsePromptTokenCount: tool,
    totalTokenCount: total,
  };
}

function sumUsage(usages) {
  const out = {
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    thoughtsTokenCount: 0,
    toolUsePromptTokenCount: 0,
    totalTokenCount: 0,
  };

  for (const u0 of usages) {
    const u = normalizeUsage(u0);
    if (!u) continue;
    out.promptTokenCount += u.promptTokenCount;
    out.candidatesTokenCount += u.candidatesTokenCount;
    out.thoughtsTokenCount += u.thoughtsTokenCount;
    out.toolUsePromptTokenCount += u.toolUsePromptTokenCount;
    out.totalTokenCount += u.totalTokenCount;
  }
  return out;
}

/**
 * ✅ 2-step (Search -> Convert to strict JSON)
 * - Step1: เปิด googleSearch tools (ห้ามใส่ responseMimeType: application/json)
 * - Step2: ปิด tools แล้วใช้ responseMimeType: application/json เพื่อให้ parse ได้ชัวร์
 */
exports.geminiGenerateExcel = async (
  messageList,
  historyList,
  {
    model = "gemini-2.5-pro",
    outDir = "./uploads",
    fileBase = "report",
    sheetName = "Sheet1",
    jsonInstruction = true,
    enableGoogleSearch = true,
    debug = false,
  } = {}
) => {
  const ai = await getAI();
  fs.mkdirSync(outDir, { recursive: true });

  // รวมข้อความล่าสุดเป็น parts
  const parts = Array.isArray(messageList)
    ? [...messageList]
    : [{ text: String(messageList ?? "") }];

  if (jsonInstruction) {
    parts.push({
      text:
        "IMPORTANT: Return ONLY JSON (no markdown, no explanation). " +
        "Output must match ONE of these shapes:\n" +
        '1) [{"colA": "...", "colB": 123}]\n' +
        '2) {"sheetName":"Sheet1","rows":[{"colA":"..."}]}\n' +
        '3) {"sheets":[{"name":"Sheet1","rows":[{"colA":"..."}]}]}',
    });
  }

  const contents = [
    ...(Array.isArray(historyList) ? historyList : []),
    { role: "user", parts },
  ];

  // Step 1) เปิด googleSearch
  const respSearch = await ai.models.generateContent({
    model,
    contents,
    config: enableGoogleSearch ? { tools: [{ googleSearch: {} }] } : undefined,
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
    // Step 2) strict JSON
    const extra = `
Output JSON in ONE of these exact shapes only:
1) Array of objects: [{"colA": "...", "colB": 123}]
2) Object with rows: {"sheetName":"Sheet1","rows":[{"colA":"..."}]}
3) Object with sheets: {"sheets":[{"name":"Sheet1","rows":[{"colA":"..."}]}]}
`;

    const strict = await forceStrictJson(ai, model, rawText, extra);
    payload = coerceExcelPayload(strict.payload);
    jsonTextUsed = strict.jsonText;
    respJson = strict.response;
  }

  if (debug) {
    // console.log("payload typeof:", typeof payload, "isArray:", Array.isArray(payload));
    // console.log("payload keys:", payload && typeof payload === "object" ? Object.keys(payload).slice(0, 20) : null);
    // console.log("jsonTextUsed preview:", String(jsonTextUsed).slice(0, 800));
  }

  // สร้าง sheets ตาม payload
  const sheets = normalizeToSheets(payload, sheetName);

  const wb = new ExcelJS.Workbook();
  wb.creator = "ONESQA";
  wb.created = new Date();

  for (const s of sheets) {
    const ws = wb.addWorksheet(String(s.name || "Sheet"));

    ws.columns = (s.headers || []).map((h) => ({
      header: String(h),
      key: String(h),
    }));

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

  // ✅ รวม usageMetadata ของ search + json
  const mergedUsageMetadata = sumUsage([pickUsage(respSearch), pickUsage(respJson)]);

  return {
    files: [outPath],
    text: jsonTextUsed,
    rawText,
    // ✅ response รูปแบบใหม่: รวม search + json + usageMetadata (รวม)
    response: {
      search: respSearch,
      json: respJson, // null ถ้ารอบแรก parse ได้เลย
      usageMetadata: mergedUsageMetadata,
    },
  };
};
