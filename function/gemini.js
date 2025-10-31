const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

// โหลด API KEY
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("API_KEY is missing in .env");
  process.exit(1);
}

// สร้างอินสแตนซ์ของ Gemini
const genAI = new GoogleGenerativeAI(API_KEY);

exports.geminiChat = async (messageList, historyList, model_name) => {
  // console.log("historyList", historyList);
  // console.log("messageList", messageList);

  const model = genAI.getGenerativeModel({
    model: model_name, // ✅ ใช้ชื่อที่รองรับ
  });

  try {
    const chat = model.startChat({
      history: historyList,
    });

    const result = await chat.sendMessage(messageList);

    const response = result.response;
    const text = await response.text();

    //console.log(response);

    return { text, response };
  } catch (error) {
    console.error(error);
  }
};
