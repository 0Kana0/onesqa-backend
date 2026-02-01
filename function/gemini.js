const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const { GoogleAIFileManager } = require("@google/generative-ai/server");
const fileMgr = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

async function waitUntilActive(fileName, { timeoutMs = 60_000, intervalMs = 1_500 } = {}) {
  const start = Date.now();
  while (true) {
    const f = await fileMgr.getFile(fileName);        // ใช้ file.name ที่ได้ตอนอัปโหลด
    const state = f.state || f.file?.state;
    if (state === "ACTIVE") return f.file ?? f;     // คืน object ไฟล์ที่พร้อมใช้
    if (state === "FAILED") throw new Error(`File ${fileName} failed to process.`);
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting for ${fileName} (last=${state}).`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
}
exports.uploadAndWait = async (localPath, mimeType, displayName) => {
  const up = await fileMgr.uploadFile(localPath, { mimeType, displayName });
  const uploaded = up.file ?? up;                   // บางเวอร์ชันเป็น up.file
  // debug: ดูว่าหลังอัปสถานะอะไร
  // console.log({ name: uploaded.name, uri: uploaded.uri, state: uploaded.state });
  const ready = await waitUntilActive(uploaded.name);
  return ready; // มี ready.uri, ready.mimeType
}

exports.geminiChat = async (messageList, historyList, model_name, { enableGoogleSearch = true } = {}) => {
  const model = genAI.getGenerativeModel({
    model: model_name,
    ...(enableGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}), // ✅ เปิด/ปิดตาม flag
  });

  // (ถ้าต้องการให้รู้วันที่/เวลาไทยเสมอ แทรก system-like preface ใน history เอง)
  const chat = model.startChat({ history: historyList });

  const result = await chat.sendMessage(messageList);
  const text = await result.response.text();
  return { text, response: result.response };
};

