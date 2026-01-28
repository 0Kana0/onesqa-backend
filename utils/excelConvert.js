const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const JSZip = require("jszip");

exports.extractTextFromExcel = async (filePath) => {
  // ---------------------- ส่วนอ่านข้อความเดิม ----------------------
  const workbook = XLSX.readFile(filePath);
  const sheetNames = workbook.SheetNames;

  const text = sheetNames
    .map((sheetName) => {
      function isEmpty(v) {
        return v === undefined || v === null || String(v).trim() === "";
      }

      function trimRow(row) {
        let end = row.length - 1;
        while (end >= 0 && isEmpty(row[end])) end--;
        return row.slice(0, end + 1);
      }

      const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        blankrows: false,
      });

      const cleaned = sheetData
        .map(r => trimRow(r).map(v => (v == null ? "" : String(v))))
        .filter(r => r.length && r.some(v => !isEmpty(v)));

      const tableText = cleaned.map(r => r.join("\t")).join("\n");

      // รวมชื่อชีทกับเนื้อหา
      return `=== Sheet: ${sheetName} ===\n${tableText}`;
    })
    .join("\n\n"); // เว้นบรรทัดระหว่างชีท

  // ---------------------- ส่วนอ่านรูปภาพจากไฟล์ Excel ----------------------
  const fileBuffer = await fs.promises.readFile(filePath);

  // โหลดเป็น zip
  const zip = await JSZip.loadAsync(fileBuffer);

  const images = [];
  const mediaFolder = "xl/media/"; // รูปใน Excel จะอยู่โฟลเดอร์นี้

  // วนหาไฟล์ทั้งหมดที่อยู่ใน xl/media/
  const mediaFiles = Object.keys(zip.files).filter((name) =>
    name.startsWith(mediaFolder)
  );

  for (const name of mediaFiles) {
    const file = zip.file(name);
    if (!file) continue;

    // อ่านเป็น buffer
    const buffer = await file.async("nodebuffer");
    const ext = path.extname(name).toLowerCase().replace(".", ""); // png, jpg, jpeg, gif ฯลฯ

    // เดา mime type จากนามสกุล
    let mimeType = "application/octet-stream";
    if (ext === "png") mimeType = "image/png";
    else if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
    else if (ext === "gif") mimeType = "image/gif";

    const base64 = buffer.toString("base64");

    images.push({
      filename: path.basename(name),
      ext,
      mimeType,
      base64, // เอาไปสร้าง data URL / ส่งเข้า Gemini ได้
      dataUrl: `data:${mimeType};base64,${base64}`,
    });
  }

  // คืนทั้งข้อความ + รูปภาพ
  return {
    text,
    images,
  };
};
