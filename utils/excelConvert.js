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
      const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1, // คืนค่าเป็น array ของแถว
      });

      const tableText = sheetData.map((row) => row.join("\t")).join("\n");

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
