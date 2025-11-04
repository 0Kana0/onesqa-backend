const XLSX = require("xlsx");

exports.extractTextFromExcel = async (filePath) => {
  // 1. อ่านไฟล์ Excel
  const workbook = XLSX.readFile(filePath);

  // 2. ดึงชื่อทุก Sheet
  const sheetNames = workbook.SheetNames;

  // 3. รวมข้อความทุก Sheet เป็นก้อนเดียว
  const fullText = sheetNames.map((sheetName) => {
    const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1, // คืนค่าเป็น array ของแถว
    });

    const tableText = sheetData.map((row) => row.join("\t")).join("\n");

    // รวมชื่อชีทกับเนื้อหา
    return `=== Sheet: ${sheetName} ===\n${tableText}`;
  }).join("\n\n"); // เว้นบรรทัดระหว่างชีท

  return fullText;
};
