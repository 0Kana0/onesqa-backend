const fs = require("fs").promises;
const path = require("path");

/**
 * ลบไฟล์จากพาธที่กำหนด
 * @param {string} filePath - พาธเต็มของไฟล์ เช่น '/var/www/uploads/test.pdf'
 * @returns {Promise<boolean>} true ถ้าลบสำเร็จ, false ถ้าไม่พบไฟล์
 */
async function deleteFile(filePath) {
  try {
    await fs.unlink(filePath);
    // console.log(`✅ ลบไฟล์สำเร็จ: ${filePath}`);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") {
      // console.warn(`⚠️ ไม่พบไฟล์: ${filePath}`);
      return false;
    }
    // console.error(`❌ ลบไฟล์ไม่สำเร็จ: ${filePath}`, err);
    throw err;
  }
}

/**
 * ลบไฟล์ในโฟลเดอร์ uploads จากชื่อไฟล์ (auto join path)
 * @param {string} fileName - ชื่อไฟล์ เช่น 'test.pdf'
 * @param {string} [subFolder=''] - โฟลเดอร์ย่อย (optional)
 * @returns {Promise<boolean>}
 */
async function deleteUploadFile(fileName, subFolder = "") {
  const filePath = path.join(
    __dirname,
    "..",
    "uploads",
    subFolder,
    fileName
  );
  return await deleteFile(filePath);
}

/**
 * ลบหลายไฟล์พร้อมกัน
 * @param {string[]} fileNames - array ของ path ที่ต้องการลบ
 * @returns {Promise<void>}
 */
async function deleteMultipleFiles(fileNames = []) {
  await Promise.all(
    fileNames.map(async (fileName) => {
      const filePath = path.join(__dirname, "..", 'uploads', fileName);
      // console.log(filePath);
      
      await deleteFile(filePath);
    })
  );
  // console.log("✅ ลบไฟล์ทั้งหมดเรียบร้อย");
}

module.exports = {
  deleteFile,
  deleteUploadFile,
  deleteMultipleFiles,
};
