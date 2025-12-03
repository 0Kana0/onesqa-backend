const mammoth = require('mammoth');

exports.extractTextFromWord = async (filePath) => {
  const images = [];

  // 1) ดึงข้อความแบบเดิม (raw text)
  const wordData = await mammoth.extractRawText({ path: filePath });

  // 2) ดึงรูปภาพทั้งหมดในไฟล์
  await mammoth.convertToHtml(
    { path: filePath },
    {
      convertImage: mammoth.images.inline(async (image) => {
        const buffer = await image.read();              // Buffer ของรูป
        const contentType = image.contentType;          // เช่น 'image/png'
        const base64 = buffer.toString("base64");
        const dataUrl = `data:${contentType};base64,${base64}`;

        images.push({
          contentType,  // mime type
          buffer,       // ไว้เซฟไฟล์ / อัปโหลดต่อ
          base64,       // ไว้ส่งเข้า AI / API ต่าง ๆ
          dataUrl,      // ใช้แสดงบนหน้าเว็บ <img src="..." />
        });

        // สำหรับกรณีที่ยังอยากได้ HTML จาก mammoth ด้วย
        return { src: dataUrl };
      }),
    }
  );

  return {
    text: wordData.value, // ข้อความทั้งหมดใน Word
    images,               // array ข้อมูลรูปภาพทั้งหมด
  };
};
