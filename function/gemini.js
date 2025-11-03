const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

exports.geminiChat = async (messageList, historyList, model_name) => {
  const model = genAI.getGenerativeModel({
    model: model_name,
    tools: [{ googleSearch: {} }],   // ✅ ต้องอยู่ระดับนี้
  });

  // (ถ้าต้องการให้รู้วันที่/เวลาไทยเสมอ แทรก system-like preface ใน history เอง)
  const chat = model.startChat({ history: historyList });

  const result = await chat.sendMessage(
    messageList
  );
  const text = await result.response.text();
  return { text, response: result.response };
};
