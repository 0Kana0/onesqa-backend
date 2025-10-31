const OpenAI = require("openai");
require("dotenv").config();

// สร้าง instance ของ OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

exports.openAiChat = async (historyList, model_name) => {
  // console.log(historyList);
  
  try {
    const response = await openai.chat.completions.create({
      model: model_name, // รองรับทั้งข้อความและภาพ
      messages: historyList
    });

    //console.log(response);
    //console.log("ผลวิเคราะห์:", response.choices[0].message.content);
    const text = response.choices[0].message.content;

    return { text, response };
  } catch (error) {
    console.error(error);
  }
};
