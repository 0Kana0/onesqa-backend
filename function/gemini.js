const path = require("path");

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const { GoogleAIFileManager } = require("@google/generative-ai/server");
const fileMgr = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

exports.geminiChat = async (messageList, historyList, model_name) => {
  const model = genAI.getGenerativeModel({
    model: model_name,
    tools: [{ googleSearch: {} }],   // ✅ ต้องอยู่ระดับนี้
  });

  // (ถ้าต้องการให้รู้วันที่/เวลาไทยเสมอ แทรก system-like preface ใน history เอง)
  const chat = model.startChat({ history: historyList });

  //const path_file1 = path.join(__dirname, `../uploads/518289279_2480801182285527_1633658446541370672_n.png`); // ไฟล์ต้นทาง
  // console.log(path_file);
  // //ถ้าจะส่งไฟล์ที่อัปโหลดไว้แล้ว:
  // const file = await uploadFileOnce(path_file, "image/png", "mydoc");

  //const path_file2 = path.join(__dirname, `../uploads/dc5e82c4a0f3cbb70737a6e2268157e0.jpg`); // ไฟล์ต้นทาง
  // console.log(path_file);
  // //ถ้าจะส่งไฟล์ที่อัปโหลดไว้แล้ว:
  // const file = await uploadFileOnce(path_file, "image/jpeg", "mydoc");

  const path_file1 = path.join(__dirname, `../uploads/รายงานผลการดำเนินงานOKRประจำปี2568_หน่วยงาน_รอบ6เดือน (5).pdf`); // ไฟล์ต้นทาง
  const path_file2 = path.join(__dirname, `../uploads/สรุปรายงานแผนปี (25).pdf`); // ไฟล์ต้นทาง

  // // 1) อัปโหลดหลายรูปครั้งเดียว
  // const uploads = await Promise.all([
  //   fileMgr.uploadFile(path_file1, { mimeType: "image/jpeg", displayName: "a" }),
  //   fileMgr.uploadFile(path_file2, { mimeType: "image/png",  displayName: "b" }),
  //   // เพิ่มได้ตามต้องการ
  // ]);

  // 1) อัปโหลดหลายรูปครั้งเดียว
  const uploads = await Promise.all([
    fileMgr.uploadFile(path_file1, { mimeType: "application/pdf", displayName: "a" }),
    fileMgr.uploadFile(path_file2, { mimeType: "application/pdf",  displayName: "b" }),
    // เพิ่มได้ตามต้องการ
  ]);

  // 2) สร้าง parts หลายรูป + ข้อความ แล้วส่ง
  // const messageListTest = [
  //   { text: "อธิบายเเต่ละภาพให้หน่อย" },
  //   ...uploads.map(u => ({ fileData: { fileUri: u.file.uri, mimeType: u.file.mimeType } })),
  // ];

  const messageListTest = [
    { text: "สรุปให้หน่อย" },
    ...uploads.map(u => ({ fileData: { fileUri: u.file.uri, mimeType: u.file.mimeType } })),
  ];

  const result = await chat.sendMessage(messageListTest);
  const text = await result.response.text();
  return { text, response: result.response };
};
