const OpenAI = require("openai");
require("dotenv").config();

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.openAiChat = async (historyList, model_name) => {
  // historyList: [{ role: "system"|"user"|"assistant", content: "..." }, ...]
  const resp = await client.responses.create({
    model: model_name,
    input: historyList,                 // ใช้ array เดิมต่อได้
    tools: [{ type: "web_search" }],    // ให้สิทธิ์ค้นเว็บ
    tool_choice: "auto"                 // ปล่อยให้โมเดลตัดสินใจเรียกค้นเมื่อจำเป็น
  });

  const text = resp.output_text;        // helper ใน Responses API
  return { text, response: resp };
};
