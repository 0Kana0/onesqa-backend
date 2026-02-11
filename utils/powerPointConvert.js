// extractTextFromPowerPoint.js
// ดึงข้อความ + รูปจาก PowerPoint แล้วแปลงรูปเป็น PNG (เท่าที่ sharp รองรับ)

const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const sharp = require("sharp");

/**
 * อ่านไฟล์ PPTX แล้ว:
 *  - text: ข้อความจากทุกสไลด์ (<a:t>)
 *  - imagesForGemini: รูปที่ถูกแปลงเป็น PNG เรียบร้อยแล้ว (base64 + mime)
 *  - imagesAll: รูปดิบทั้งหมดจาก ppt/media (ทุกชนิดไฟล์)
 */
async function extractTextFromPowerPoint(filePath) {
  const buffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buffer);

  let text = "";

  const imagesAll = [];        // รูปดิบทั้งหมด
  const imagesForGemini = [];  // รูป PNG สำหรับส่งเข้า Gemini

  // ------------------------------------------------
  // 1) ดึงข้อความจากสไลด์ ppt/slides/slide*.xml
  // ------------------------------------------------
  const slideRegex = /^ppt\/slides\/slide\d+\.xml$/;

  for (const filename of Object.keys(zip.files)) {
    if (!slideRegex.test(filename)) continue;

    const xml = await zip.files[filename].async("text");

    // ดึงข้อความจาก <a:t> ... </a:t>
    const matches = [...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)];
    matches.forEach((m) => {
      text += m[1] + "\n";
    });
  }

  // ------------------------------------------------
  // 2) ดึง media ทั้งหมดจาก ppt/media/*
  //    แล้วพยายามแปลงทุกอันเป็น PNG ด้วย sharp
  // ------------------------------------------------
  for (const filename of Object.keys(zip.files)) {
    if (!filename.startsWith("ppt/media/")) continue;

    const file = zip.files[filename];
    const ext = path.extname(filename).toLowerCase();
    const baseName = path.basename(filename);

    // อ่านเป็น buffer
    const fileBuffer = await file.async("nodebuffer");
    const base64Raw = fileBuffer.toString("base64");

    const rawMime = guessMimeFromExt(ext);

    // เก็บรูปดิบไว้ทั้งหมด
    imagesAll.push({
      fileName: baseName,
      ext,
      contentType: rawMime,
      base64: base64Raw,
      size: fileBuffer.length,
    });

    // พยายามแปลงเป็น PNG ด้วย sharp
    try {
      const pngBuffer = await sharp(fileBuffer).png().toBuffer();
      const base64Png = pngBuffer.toString("base64");

      imagesForGemini.push({
        fileName: baseName.replace(ext, ".png"),
        contentType: "image/png",
        base64: base64Png,
      });
    } catch (err) {
      // sharp แปลงไม่ได้ (เช่น emf / wmf / บาง svg) → ข้ามแปลง แต่ยังมีใน imagesAll
      // console.warn("⚠️ Cannot convert image to PNG:", baseName, "-", err.message);
    }
  }

  return {
    text,
    imagesForGemini, // ส่งอันนี้ให้ Gemini
    imagesAll,       // ถ้าอยากเก็บ/โหลด/แสดงเอง
  };
}

// เดา mime type แบบง่าย ๆ จากนามสกุล
function guessMimeFromExt(ext) {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".bmp":
      return "image/bmp";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".emf":
      return "image/x-emf";
    case ".wmf":
      return "image/x-wmf";
    default:
      return "application/octet-stream";
  }
}

module.exports = {
  extractTextFromPowerPoint,
};
