const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const JSZip = require("jszip");

// helper: A1 เช่น (col=0,row=0) => A1
function toA1(colIdx, rowIdx) {
  let n = colIdx + 1;
  let col = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    col = String.fromCharCode(65 + r) + col;
    n = Math.floor((n - 1) / 26);
  }
  return `${col}${rowIdx + 1}`;
}

function isEmpty(v) {
  return v === undefined || v === null || String(v).trim() === "";
}

function trimRow(row) {
  let end = row.length - 1;
  while (end >= 0 && isEmpty(row[end])) end--;
  return row.slice(0, end + 1);
}

function clampText(s, maxLen) {
  const t = String(s ?? "");
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + "…";
}

exports.extractTextFromExcel = async (filePath, options = {}) => {
  // ---------- ปรับแต่งได้ ----------
  const {
    maxSheets = 200000,          // กันไฟล์มีชีทเยอะ
    maxRowsPerSheet = 200000,   // กันแถวเยอะ
    maxColsPerRow = 200000,      // กันคอลัมน์เยอะ
    maxCellChars = 200000,      // กัน cell ยาว
    includeEmptyRows = false,
    // รูป
    maxImages = 20,
    maxImageBytes = 4 * 1024 * 1024, // 4MB ต่อรูป
  } = options;

  // ---------------------- ส่วนอ่านข้อความ ----------------------
  const workbook = XLSX.readFile(filePath, {
    cellDates: true,
    raw: false, // ให้ XLSX แปลงค่าบางส่วนให้เหมาะอ่าน
  });

  const sheetNames = (workbook.SheetNames || []).slice(0, maxSheets);

  function packRowParts({ sheetName, rowNumber, parts, maxLineChars = 1400 }) {
    const out = [];
    let group = [];
    let prefixBase = `Sheet=${sheetName} | ROW ${rowNumber}: `;
    let prefix = prefixBase;

    for (const part of parts) {
      const candidate = (group.length ? group.join(" | ") + " | " : "") + part;
      if ((prefix + candidate).length > maxLineChars) {
        if (group.length) out.push(prefix + group.join(" | "));
        group = [part];
        prefix = `Sheet=${sheetName} | ROW ${rowNumber} (cont): `;
      } else {
        group.push(part);
      }
    }
    if (group.length) out.push(prefix + group.join(" | "));
    return out;
  }

  const text = sheetNames
    .map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return `=== Sheet: ${sheetName} ===\n(ไม่พบข้อมูลชีท)`;

      // header:1 => array-of-arrays
      const sheetData = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        blankrows: includeEmptyRows,
        defval: "", // ให้ cell ว่างเป็น ""
      });

      // หา header row (แถวแรกที่มีข้อความ >= 2 ช่อง)
      const rows = sheetData
        .map(r => trimRow(r).map(v => (v == null ? "" : String(v))))
        .filter(r => r.length);

      const headerIdx = rows.findIndex(r => r.filter(v => !isEmpty(v)).length >= 2);
      const headers = headerIdx >= 0 ? rows[headerIdx].map(v => clampText(v, 80)) : [];
      const start = headerIdx >= 0 ? headerIdx + 1 : 0;

      const cleaned = [];
      for (let r = start; r < Math.min(rows.length, start + maxRowsPerSheet); r++) {
        const row = rows[r].slice(0, maxColsPerRow).map(v => clampText(v, maxCellChars));
        if (!row.some(v => !isEmpty(v))) continue;

        const parts = [];
        for (let c = 0; c < row.length; c++) {
          const val = row[c];
          if (isEmpty(val)) continue;

          const key = headers[c] && !isEmpty(headers[c]) ? headers[c] : toA1(c, r);
          parts.push(`${key}=${val}`);
        }
        const lines = packRowParts({
          sheetName,
          rowNumber: r + 1,
          parts,
          maxLineChars: 1400,
        });
        cleaned.push(...lines);
      }

      if (!cleaned.length) {
        return `=== Sheet: ${sheetName} ===\n(ไม่มีข้อมูลที่อ่านได้)`;
      }

      // ใส่หัว sheet เพื่อช่วย RAG filter
      return `=== Sheet: ${sheetName} ===\n${cleaned.join("\n")}`;
    })
    .join("\n\n"); // เว้นบรรทัดระหว่างชีท

  // ---------------------- ส่วนอ่านรูปภาพจากไฟล์ Excel ----------------------
  const fileBuffer = await fs.promises.readFile(filePath);

  // โหลดเป็น zip
  const zip = await JSZip.loadAsync(fileBuffer);

  const images = [];
  const mediaFolder = "xl/media/";
  const mediaFiles = Object.keys(zip.files).filter((name) => name.startsWith(mediaFolder));

  for (const name of mediaFiles) {
    if (images.length >= maxImages) break;

    const file = zip.file(name);
    if (!file) continue;

    // อ่านเป็น buffer
    const buffer = await file.async("nodebuffer");
    if (buffer.length > maxImageBytes) continue; // กันรูปใหญ่เกิน

    const ext = path.extname(name).toLowerCase().replace(".", "");

    // เดา mime type จากนามสกุล
    let mimeType = "application/octet-stream";
    if (ext === "png") mimeType = "image/png";
    else if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
    else if (ext === "gif") mimeType = "image/gif";
    else if (ext === "webp") mimeType = "image/webp";

    const base64 = buffer.toString("base64");

    images.push({
      filename: path.basename(name),
      ext,
      mimeType,
      base64,
      dataUrl: `data:${mimeType};base64,${base64}`,
      sizeBytes: buffer.length,
    });
  }

  return { text, images };
};
