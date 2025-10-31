// controllers/message.controller.js
const { Op } = require("sequelize");
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { geminiChat } = require("../function/gemini");
const { openAiChat } = require("../function/openai");
const { Message, Chat, Ai } = db;

exports.listMessages = async ({ chat_id }) => {
  return await Message.findAll({
    where: { chat_id: chat_id },
    order: [["id", "ASC"]],
  });
};

exports.getMessageById = async (id) => {
  return await Message.findByPk(id);
};

exports.createMessage = async (input) => {
  const { chat_id, message } = input;
  console.log(chat_id, message);

  // เรียกดูข้อมูลของ chat เพื่อดูว่าใช้ model อันไหน
  const chatOne = await Chat.findByPk(chat_id, {
    include: [
      {
        model: Ai,
        as: "ai", // ต้องตรงกับ alias ใน association
      },
    ],
  });
  console.log(chatOne.ai.model_type);
  // ดึงข้อมูลของ chat ทั้งหมดที่อยู่ใน chatgroup นี้
  const messageAllByChatId = await Message.findAll({
    where: { chat_id: chat_id },
  });

  console.log(messageAllByChatId);

  // ถ้าใช้ gemini
  if (chatOne.ai.model_type === "gemini") {
    
    // สร้าง array สำหรับเก็บ prompt ที่ผ่านมาโดยมี prompt ตั้งต้น
    const historyList = [
      { role: "user", parts: [{ text: "คุณคือผู้ช่วยส่วนตัว" }] },
      {
        role: "model",
        parts: [{ text: "รับทราบครับ ผมจะทำหน้าที่เป็นผู้ช่วยของคุณ" }],
      },
    ];
    // เก็บ prompt ที่ผ่านมาทั้งหมดใน array
    for (const message of messageAllByChatId) {
      //const fileParts = await processFiles(message.file);

      const history = {
        role: message.role,
        parts: [
          { text: message.text },
          // สำหรับส่งไฟล์ไปที่ model
          //...fileParts,
        ],
      };
      historyList.push(history);
    }
    //console.log(historyList);

    // เก็บคำถามล่าสุดที่ถามใน array
    //const filteredFiles = await processFiles(fileMessageList);
    const messageList = [
      { text: message },
      // สำหรับส่งไฟล์ไปที่ model
      //...filteredFiles,
    ];
    //console.log(messageList);

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { text, response } = await geminiChat(messageList, historyList, chatOne.ai.model_name);
    console.log("text", text);
    console.log("response", response);

    // เก็บคำถามลงใน db
    try {
      await Message.create({
        role: "user",
        text: message,
        //file: fileMessageList,
        input_token: 0,
        output_token: 0,
        total_token: 0,
        chat_id: chat_id,
      });
    } catch (error) {
      console.log(error);
    }

    // เก็บคำตอบจาก model ลงใน db
    try {
      await Message.create({
        role: "model",
        text: text,
        file: [],
        input_token: response.usageMetadata.promptTokenCount,
        output_token: response.usageMetadata.candidatesTokenCount + response.usageMetadata.thoughtsTokenCount,
        total_token: response.usageMetadata.totalTokenCount,
        chat_id: chat_id,
      });
    } catch (error) {
      console.log(error);
    }

    return {
      text: text,
    };

    // ถ้าใช้ openai
  } else if (chatOne.ai.model_type === "gpt") {

    // สร้าง array สำหรับเก็บ prompt ที่ผ่านมาโดยมี prompt ตั้งต้น
    const historyList = [
      {
        role: "system",
        content: [{ type: "text", text: "You are a helpful assistant." }],
      },
    ];
    // เก็บ prompt ที่ผ่านมาทั้งหมดใน array
    for (const message of messageAllByChatId) {
      //const fileParts = await processFiles(chat.file);

      const history = {
        role: message.role,
        content: [
          { type: "text", text: message.text },
          // สำหรับส่งไฟล์ไปที่ model
          //...fileParts
        ],
      };
      historyList.push(history);
    }

    // เก็บคำถามล่าสุดที่ถามใน array
    //const filteredFiles = await processFiles(fileMessageList);
    const messagePrompt = {
      role: "user",
      content: [
        { type: "text", text: message },
        // สำหรับส่งไฟล์ไปที่ model
        //...filteredFiles
      ],
    };

    historyList.push(messagePrompt);
    //console.log(historyList);

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { text, response } = await openAiChat(historyList, chatOne.ai.model_name);
    console.log("text", text);
    console.log("response", response);

    // เก็บคำถามลงใน db
    try {
      await Message.create({
        role: "user",
        text: message,
        //file: fileMessageList,
        input_token: 0,
        output_token: 0,
        total_token: 0,
        chat_id: chat_id,
      });
    } catch (error) {
      console.log(error);
    }

    // เก็บคำตอบจาก model ลงใน db
    try {
      await Message.create({
        role: "assistant",
        text: text,
        file: [],
        input_token: response.usage.prompt_tokens,
        output_token: response.usage.completion_tokens,
        total_token: response.usage.total_tokens,
        chat_id: chat_id,
      });
    } catch (error) {
      console.log(error);
    }

    return {
      text: text,
    };
  }
  //return await Message.create(input);
};

exports.updateMessage = async (id, input) => {
  const row = await Message.findByPk(id);
  if (!row) throw new Error("Message not found");

  await row.update(input);
  return row;
};

exports.deleteMessage = async (id) => {
  const count = await Message.destroy({ where: { id } });
  return count > 0;
};
