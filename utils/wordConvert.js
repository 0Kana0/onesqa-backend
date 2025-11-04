const mammoth = require('mammoth');

exports.extractTextFromWord = async (filePath) => {
  const wordData = await mammoth.extractRawText({ path: filePath });
  return wordData.value; // ข้อความใน word
}
