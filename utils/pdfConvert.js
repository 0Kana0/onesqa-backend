const fs = require("fs/promises");
const { getDocumentProxy, extractText, extractImages } = require("unpdf");
const sharp = require("sharp");

/**
 * อ่าน PDF แล้วดึงทั้ง text + รูปที่ฝังอยู่ใน PDF
 * return: {
 *   text: string,
 *   images: Array<{
 *     page: number,
 *     index: number,
 *     width: number,
 *     height: number,
 *     channels: 1 | 3 | 4,
 *     mimeType: "image/png",
 *     data: string, // base64 ของ PNG
 *   }>
 * }
 */
exports.extractTextFromPDF = async (filePath) => {
  // 1) โหลดไฟล์ PDF เป็น buffer
  const data = await fs.readFile(filePath);
  const pdf = await getDocumentProxy(new Uint8Array(data));

  // 2) ดึงข้อความทั้งหมด (mergePages = true รวมเป็นสตริงเดียว)
  const { totalPages, text } = await extractText(pdf, { mergePages: true });

  // 3) วนทีละหน้าแล้วดึง "รูปที่ฝังอยู่" ด้วย extractImages
  const allImages = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const imagesOnPage = await extractImages(pdf, pageNum);

    // imagesOnPage = array ของ { data: Uint8ClampedArray, width, height, channels, key }
    for (let i = 0; i < imagesOnPage.length; i++) {
      const img = imagesOnPage[i];

      // แปลง raw data → PNG ด้วย sharp
      const rawBuffer = Buffer.from(img.data);

      const pngBuffer = await sharp(rawBuffer, {
        raw: {
          width: img.width,
          height: img.height,
          channels: img.channels,
        },
      })
        .png()
        .toBuffer();

      allImages.push({
        page: pageNum,
        index: i + 1,
        width: img.width,
        height: img.height,
        channels: img.channels,
        mimeType: "image/png",
        data: pngBuffer.toString("base64"), // ส่งให้ Gemini เป็น inlineData ได้เลย
      });
    }
  }

  return {
    text,
    images: allImages,
  };
};
