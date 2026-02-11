// utils/convertWebmToMp3.js
const db = require("../db/models"); // ปรับ path ตามโปรเจ็กต์จริง
const fs = require("fs/promises");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const { removeFirstPrefix } = require("./filename");

const { File } = db;

// ตั้ง path ให้ fluent-ffmpeg ใช้ binary จาก @ffmpeg-installer
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * แปลงไฟล์ .webm เป็น .mp3
 * @param {string} fileName   - ชื่อไฟล์ต้นฉบับ (เช่น 'recording-xxx.webm') = file_name เดิมใน DB
 * @param {string} inputPath  - path ของไฟล์ .webm ต้นฉบับ บนดิสก์
 * @param {string} [outputPath] - path ปลายทาง (ถ้าไม่ส่งมา จะสร้างชื่อ .mp3 ให้เอง)
 * @returns {Promise<{ fileName: string, mimeType: string, filePath: string }>}
 */
function convertWebmToMp3(fileName, inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    // ถ้าไม่ได้ส่ง outputPath มา สร้างชื่อ .mp3 ให้เองข้าง ๆ กัน
    if (!outputPath) {
      const ext = path.extname(inputPath); // .webm
      outputPath = inputPath.replace(ext, ".mp3");
    }

    ffmpeg(inputPath)
      .noVideo()
      .audioCodec("libmp3lame")
      .format("mp3")
      .on("end", async () => {
        try {
          // ชื่อไฟล์ mp3 (เอามาจาก outputPath กันพลาด)
          const mp3FileName = path.basename(outputPath);
          const mimeType = "audio/mpeg"; // MIME type มาตรฐานของ mp3

          // อ่านขนาดไฟล์ mp3 (หน่วย bytes)
          const stats = await fs.stat(outputPath);
          const fileSize = stats.size;

          const fileData = await File.findOne({
            where: { file_name: fileName },
          });

          if (!fileData) {
            // console.warn("File record not found for:", fileName);
          } else {
            // อัปเดต row เดิมให้เป็นข้อมูล mp3
            await File.update(
              {
                original_name: removeFirstPrefix(mp3FileName),
                file_name: mp3FileName,
                extension: "mp3",
                mime_type: mimeType,
                size_bytes: fileSize,
                stored_path: `/uploads/${mp3FileName}`,
              },
              { where: { id: fileData.id } }
            );
          }

          // >>> เพิ่ม flow: ลบไฟล์เก่าทิ้ง (ไฟล์ .webm)
          try {
            await fs.unlink(inputPath);
          } catch (e) {
            // ไม่ให้ล้มทั้งฟังก์ชัน แต่ log ไว้
            // console.error("Failed to delete original webm file:", inputPath, e);
          }

          // แล้ว resolve พร้อมข้อมูลไฟล์ใหม่
          resolve({
            fileName: mp3FileName,
            mimeType,
            filePath: outputPath,
          });
        } catch (err) {
          reject(err);
        }
      })
      .on("error", (err) => {
        reject(err);
      })
      .save(outputPath);
  });
}

module.exports = {
  convertWebmToMp3,
};
