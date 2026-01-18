"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MIME_MAP = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",

  // Excel
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",

  // Docs
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",

  // Media
  mp3: "audio/mpeg",
  mp4: "video/mp4",
};

function getMimeTypeByExt(ext, customMap) {
  const map = { ...DEFAULT_MIME_MAP, ...(customMap || {}) };
  return map[String(ext || "").toLowerCase()] || "application/octet-stream";
}

/**
 * Save generated/created files into DB (File model)
 *
 * @param {Object} params
 * @param {Array<string>} params.files              paths ที่ได้จาก generator เช่น ["./uploads/a.xlsx"]
 * @param {Object} params.FileModel                Sequelize model: File
 * @param {string} [params.uploadUrlPrefix="/uploads"]  path ที่เก็บใน stored_path
 * @param {string} [params.folder=""]              folder field ใน DB
 * @param {number|null} [params.messageId=null]    ถ้ารู้ message_id ตั้งแต่แรก
 * @param {Object} [params.mimeMap]                override/เพิ่ม mime map ได้
 *
 * @returns {Promise<Array<any>>} created File rows
 */
async function saveFilesToDb({
  files,
  FileModel,
  uploadUrlPrefix = "/uploads",
  folder = "",
  messageId = null,
  mimeMap,
}) {
  if (!Array.isArray(files) || files.length === 0) return [];
  if (!FileModel) throw new Error("saveFilesToDb: FileModel is required");

  const createdFiles = [];

  for (const absPathOrRel of files) {
    if (!absPathOrRel) continue;

    // ✅ กัน path แบบ relative
    const absPath = path.isAbsolute(absPathOrRel)
      ? absPathOrRel
      : path.join(process.cwd(), absPathOrRel);

    const file_name = path.basename(absPath);
    const extension = path.extname(file_name).slice(1).toLowerCase();

    // กันไฟล์หาย
    if (!fs.existsSync(absPath)) {
      throw new Error(`saveFilesToDb: file not found: ${absPath}`);
    }

    const size_bytes = fs.statSync(absPath).size;
    const mime_type = getMimeTypeByExt(extension, mimeMap);

    const original_name = file_name;
    const stored_path = `${uploadUrlPrefix}/${file_name}`;

    const row = await FileModel.create({
      original_name,
      file_name,
      extension,
      mime_type,
      size_bytes,
      folder,
      stored_path,
      message_id: messageId,
    });

    createdFiles.push(row);
  }

  return createdFiles;
}

module.exports = {
  saveFilesToDb,
  getMimeTypeByExt,
  DEFAULT_MIME_MAP,
};
