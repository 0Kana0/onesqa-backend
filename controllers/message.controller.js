// controllers/message.controller.js
const fs = require("fs");
const path = require("path");

const { Op } = require("sequelize");
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { geminiChat, uploadAndWait } = require("../function/gemini");
const { openAiChat } = require("../function/openai");
const { extractTextFromWord } = require("../utils/wordConvert");
const { extractTextFromExcel } = require("../utils/excelConvert");
const { deleteMultipleFiles } = require("../utils/fileUtils");
const { Message, Chat, Ai, File } = db;

exports.listMessages = async ({ chat_id }) => {
  return await Message.findAll({
    where: { chat_id: chat_id },
    order: [["id", "ASC"]],
    include: [
      {
        model: File,                // ต้องมี association: Chatgroup.hasMany(Chat, { as: 'chat', foreignKey: 'chatgroup_id' })
        as: 'files',
        attributes: ["id", "file_name", "original_name", "stored_path"],
        required: true, // บังคับว่าต้องแมตช์ role ด้วย
        separate: true,             // กัน limit/ordering ของ Chatgroup ไม่เพี้ยน
      },
    ],
  });
};

exports.getMessageById = async (id) => {
  return await Message.findByPk(id);
};

exports.createMessage = async (input) => {
  const { chat_id, message, fileMessageList } = input;
  console.log(chat_id, message, fileMessageList);

  // นำชื่อไฟล์ที่อัพโหลดเก็บเข้าไปใน array
  const list = Array.isArray(fileMessageList) ? fileMessageList : [];

  console.log("fileMessageList", fileMessageList);

  const fileMessageList_name = list.map(x => x?.filename).filter(Boolean);
  const fileMessageList_id   = list.map(x => x?.id).filter(v => v != null);

  console.log("fileMessageList_name", fileMessageList_name);
  console.log("fileMessageList_id", fileMessageList_id);

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
    order: [["id", "ASC"]],
    where: { chat_id: chat_id },
    include: [
      {
        model: File,                // ต้องมี association: Chatgroup.hasMany(Chat, { as: 'chat', foreignKey: 'chatgroup_id' })
        as: 'files',
        attributes: ["file_name"],
        required: true, // บังคับว่าต้องแมตช์ role ด้วย
        separate: true,             // กัน limit/ordering ของ Chatgroup ไม่เพี้ยน
      },
    ],
  });

  console.log("files", messageAllByChatId[0]?.files);

  // ถ้าใช้ gemini
  if (chatOne.ai.model_type === "gemini") {
    // function สำหรับแปลงไฟล์เป็นข้อมูลสำหรับส่งไป model
    async function processFiles(fileArray) {
      // fileArray เป็น array ของชื่อไฟล์ เช่น ['a.png', 'b.pdf']
      const mapped = await Promise.all(
        fileArray.map(async (filename) => {
          const ext = path.extname(filename).toLowerCase();
          // ถ้าไฟล์เป็นรูปภาพ
          if ([".png", ".jpg", ".jpeg"].includes(ext)) {
            // เก็บนามสกุลไฟล์
            let tranext = ext === ".jpg" ? "jpeg" : ext.substring(1);
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            console.log(filePath);

            // เเปลงเป็น base64
            const imgBase64 = await uploadAndWait(filePath, `image/${tranext}`, filename);

            return {
              fileData: {
                fileUri: imgBase64.uri,
                mimeType: imgBase64.mimeType,
              },
            };
            // ถ้าไฟล์เป็น pdf
          } else if (ext === ".pdf") {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            console.log(filePath);

            // แปลงไฟล์ pdf ให้เป็น text
            const pdfText = await uploadAndWait(filePath, "application/pdf", filename);
            //console.log(pdfText);

            return {
              fileData: {
                fileUri: pdfText.uri,
                mimeType: pdfText.mimeType,
              },
            };

          // ถ้าไฟล์เป็น word
          } else if ([".doc", ".docx"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ word ให้เป็น text
            const wordText = await extractTextFromWord(filePath);

            return {
              text: wordText,
            };

          // ถ้าไฟล์เป็น excel
          } else if ([".xlsx", ".xls"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ excel ให้เป็น text
            const excelText = await extractTextFromExcel(filePath);

            return {
              text: excelText,
            };
          } else if ([".pptx", ".ppt"].includes(ext)) {
            

          // ถ้าไฟล์เป็น mp3
          } else if ([".mp3"].includes(ext)) {

            // เก็บนามสกุลไฟล์
            let tranext = ext.substring(1);
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            console.log(filePath);

            // แปลงไฟล์ mp3, mp4
            const videoText = await uploadAndWait(filePath, `audio/${tranext}`, filename);
            //console.log(mp3Text);

            return {
              fileData: {
                fileUri: videoText.uri,
                mimeType: videoText.mimeType,
              },
            };

          // ถ้าไฟล์เป็น mp4
          } else if ([".mp4"].includes(ext)) {

            // เก็บนามสกุลไฟล์
            let tranext = ext.substring(1);
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            console.log(filePath);

            // แปลงไฟล์ mp3, mp4
            const videoText = await uploadAndWait(filePath, `video/${tranext}`, filename);
            //console.log(mp3Text);

            return {
              fileData: {
                fileUri: videoText.uri,
                mimeType: videoText.mimeType,
              },
            };
          } 

          // ไฟล์ที่ไม่รองรับ
          return null;
        })
      );

      // กรอง null ออก
      return mapped.filter((x) => x !== null && x !== undefined);
    }

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
      const file_history = message?.files.map(x => x?.file_name).filter(Boolean);      
      const fileParts = await processFiles(file_history);

      const history = {
        role: message.role,
        parts: [
          { text: message.text },
          // สำหรับส่งไฟล์ไปที่ model
          ...fileParts,
        ],
      };
      historyList.push(history);
    }
    //console.log(historyList);

    // เก็บคำถามล่าสุดที่ถามใน array
    const filteredFiles = await processFiles(fileMessageList_name);
    const messageList = [
      { text: message },
      // สำหรับส่งไฟล์ไปที่ model
      ...filteredFiles,
    ];
    console.log(messageList);

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { text, response } = await geminiChat(
      messageList,
      historyList,
      chatOne.ai.model_name
    );
    console.log("text", text);
    console.log("response", response);

    // เก็บคำถามลงใน db
    try {
      const sendData = await Message.create({
        role: "user",
        text: message,
        file: fileMessageList_id,
        input_token: 0,
        output_token: 0,
        total_token: 0,
        chat_id: chat_id,
      });

      for (const item of fileMessageList_id) {
        await File.update({
          message_id: sendData.id
        }, {where: {id: item}})
      }
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
        output_token:
          (response?.usageMetadata?.candidatesTokenCount ?? 0) +
          (response?.usageMetadata?.thoughtsTokenCount ?? 0) +
          (response?.usageMetadata?.toolUsePromptTokenCount ?? 0),
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
        content: [{ type: "input_text", text: "You are a helpful assistant." }],
      },
    ];
    // เก็บ prompt ที่ผ่านมาทั้งหมดใน array
    for (const message of messageAllByChatId) {
      //const fileParts = await processFiles(chat.file);
      const isAssistant = message.role === "assistant";
      const history = {
        role: message.role,
        content: [
          {
            type: isAssistant ? "output_text" : "input_text",
            text: message.text,
          },
          // สำหรับส่งไฟล์ไปที่ model
          //...fileParts
        ],
      };
      historyList.push(history);
    }

    // เก็บคำถามล่าสุดที่ถามใน array
    //const filteredFiles = await processFiles(fileMessageList_name);
    const messagePrompt = {
      role: "user",
      content: [
        { type: "input_text", text: message },
        // สำหรับส่งไฟล์ไปที่ model
        //...filteredFiles
      ],
    };

    historyList.push(messagePrompt);
    //console.log(historyList);

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { text, response } = await openAiChat(
      historyList,
      chatOne.ai.model_name
    );
    console.log("text", text);
    console.log("response", response);

    // เก็บคำถามลงใน db
    try {
      await Message.create({
        role: "user",
        text: message,
        //file: fileMessageList_id,
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
        input_token: response.usage.input_tokens,
        output_token: response.usage.output_tokens,
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
  const { chat_id, message, fileMessageList } = input;
  console.log(chat_id, message, fileMessageList);

  // ปรับให้ message_id ของ file ของ message ที่ต้องเเก้ไขเป็น null ป้องกันการถูกลบ
  const updateFile = await File.update({
    message_id: null
  }, { where: { message_id: id } })

  // 🔥 ลบ file ของ message ทั้งหมดที่มี id มากกว่า id ปัจจุบัน
  const deleteMessage = await Message.findAll({
    attributes: ["id"],
    where: {
      chat_id,
      id: {
        [Op.gt]: id, // Sequelize operator greater than
      },
    },
    order: [["id", "ASC"]],
    include: [
      {
        model: File, // ต้องมี association: Chatgroup.hasMany(Chat, { as: 'chat', foreignKey: 'chatgroup_id' })
        as: "files",
        attributes: ["id", "file_name", "stored_path"],
        required: true, // บังคับว่าต้องแมตช์ role ด้วย
        separate: true, // กัน limit/ordering ของ Chatgroup ไม่เพี้ยน
      },
    ],
  });
  // ดึงชื่อไฟล์ทั้งหมด
  const allFileNames = deleteMessage.flatMap((msg) =>
    msg.files.map((f) => f.file_name)
  );
  await deleteMultipleFiles(allFileNames);

  // 🔥 ลบ message ทั้งหมดที่มี id มากกว่าเท่ากับ id ปัจจุบัน
  const deleted = await Message.destroy({
    where: {
      chat_id,
      id: {
        [Op.gte]: id, // Sequelize operator greater than
      },
    },
  });

  // นำชื่อไฟล์ที่อัพโหลดเก็บเข้าไปใน array
  const list = Array.isArray(fileMessageList) ? fileMessageList : [];
  const fileMessageList_name = list.map(x => x?.filename).filter(Boolean);
  const fileMessageList_id   = list.map(x => x?.id).filter(v => v != null);

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
    order: [["id", "ASC"]],
    where: { chat_id: chat_id },
    include: [
      {
        model: File,                // ต้องมี association: Chatgroup.hasMany(Chat, { as: 'chat', foreignKey: 'chatgroup_id' })
        as: 'files',
        attributes: ["file_name"],
        required: true, // บังคับว่าต้องแมตช์ role ด้วย
        separate: true,             // กัน limit/ordering ของ Chatgroup ไม่เพี้ยน
      },
    ],
  });

  // ถ้าใช้ gemini
  if (chatOne.ai.model_type === "gemini") {
    // function สำหรับแปลงไฟล์เป็นข้อมูลสำหรับส่งไป model
    async function processFiles(fileArray) {
      // fileArray เป็น array ของชื่อไฟล์ เช่น ['a.png', 'b.pdf']
      const mapped = await Promise.all(
        fileArray.map(async (filename) => {
          const ext = path.extname(filename).toLowerCase();
          // ถ้าไฟล์เป็นรูปภาพ
          if ([".png", ".jpg", ".jpeg"].includes(ext)) {
            // เก็บนามสกุลไฟล์
            let tranext = ext === ".jpg" ? "jpeg" : ext.substring(1);
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            console.log(filePath);

            // เเปลงเป็น base64
            const imgBase64 = await uploadAndWait(filePath, `image/${tranext}`, filename);

            return {
              fileData: {
                fileUri: imgBase64.uri,
                mimeType: imgBase64.mimeType,
              },
            };
            // ถ้าไฟล์เป็น pdf
          } else if (ext === ".pdf") {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            console.log(filePath);

            // แปลงไฟล์ pdf ให้เป็น text
            const pdfText = await uploadAndWait(filePath, "application/pdf", filename);
            //console.log(pdfText);

            return {
              fileData: {
                fileUri: pdfText.uri,
                mimeType: pdfText.mimeType,
              },
            };

          // ถ้าไฟล์เป็น word
          } else if ([".doc", ".docx"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ word ให้เป็น text
            const wordText = await extractTextFromWord(filePath);

            return {
              text: wordText,
            };

          // ถ้าไฟล์เป็น excel
          } else if ([".xlsx", ".xls"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ excel ให้เป็น text
            const excelText = await extractTextFromExcel(filePath);

            return {
              text: excelText,
            };
          } else if ([".pptx", ".ppt"].includes(ext)) {
            

          // ถ้าไฟล์เป็น mp3
          } else if ([".mp3"].includes(ext)) {

            // เก็บนามสกุลไฟล์
            let tranext = ext.substring(1);
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            console.log(filePath);

            // แปลงไฟล์ mp3, mp4
            const videoText = await uploadAndWait(filePath, `audio/${tranext}`, filename);
            //console.log(mp3Text);

            return {
              fileData: {
                fileUri: videoText.uri,
                mimeType: videoText.mimeType,
              },
            };

          // ถ้าไฟล์เป็น mp4
          } else if ([".mp4"].includes(ext)) {

            // เก็บนามสกุลไฟล์
            let tranext = ext.substring(1);
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            console.log(filePath);

            // แปลงไฟล์ mp3, mp4
            const videoText = await uploadAndWait(filePath, `video/${tranext}`, filename);
            //console.log(mp3Text);

            return {
              fileData: {
                fileUri: videoText.uri,
                mimeType: videoText.mimeType,
              },
            };
          } 

          // ไฟล์ที่ไม่รองรับ
          return null;
        })
      );

      // กรอง null ออก
      return mapped.filter((x) => x !== null && x !== undefined);
    }

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
      const file_history = message?.files.map(x => x?.file_name).filter(Boolean);      
      const fileParts = await processFiles(file_history);

      const history = {
        role: message.role,
        parts: [
          { text: message.text },
          // สำหรับส่งไฟล์ไปที่ model
          ...fileParts,
        ],
      };
      historyList.push(history);
    }
    //console.log(historyList);

    // เก็บคำถามล่าสุดที่ถามใน array
    const filteredFiles = await processFiles(fileMessageList_name);
    const messageList = [
      { text: message },
      // สำหรับส่งไฟล์ไปที่ model
      ...filteredFiles,
    ];
    console.log(messageList);

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { text, response } = await geminiChat(
      messageList,
      historyList,
      chatOne.ai.model_name
    );
    console.log("text", text);
    console.log("response", response);

    // เก็บคำถามลงใน db
    try {
      const sendData = await Message.create({
        role: "user",
        text: message,
        file: fileMessageList_id,
        input_token: 0,
        output_token: 0,
        total_token: 0,
        chat_id: chat_id,
      });

      for (const item of fileMessageList_id) {
        await File.update({
          message_id: sendData.id
        }, {where: {id: item}})
      }
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
        output_token:
          (response?.usageMetadata?.candidatesTokenCount ?? 0) +
          (response?.usageMetadata?.thoughtsTokenCount ?? 0) +
          (response?.usageMetadata?.toolUsePromptTokenCount ?? 0),
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
        content: [{ type: "input_text", text: "You are a helpful assistant." }],
      },
    ];
    // เก็บ prompt ที่ผ่านมาทั้งหมดใน array
    for (const message of messageAllByChatId) {
      //const fileParts = await processFiles(chat.file);
      const isAssistant = message.role === "assistant";
      const history = {
        role: message.role,
        content: [
          {
            type: isAssistant ? "output_text" : "input_text",
            text: message.text,
          },
          // สำหรับส่งไฟล์ไปที่ model
          //...fileParts
        ],
      };
      historyList.push(history);
    }

    // เก็บคำถามล่าสุดที่ถามใน array
    //const filteredFiles = await processFiles(fileMessageList_name);
    const messagePrompt = {
      role: "user",
      content: [
        { type: "input_text", text: message },
        // สำหรับส่งไฟล์ไปที่ model
        //...filteredFiles
      ],
    };

    historyList.push(messagePrompt);
    //console.log(historyList);

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { text, response } = await openAiChat(
      historyList,
      chatOne.ai.model_name
    );
    console.log("text", text);
    console.log("response", response);

    // เก็บคำถามลงใน db
    try {
      await Message.create({
        role: "user",
        text: message,
        //file: fileMessageList_id,
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
        input_token: response.usage.input_tokens,
        output_token: response.usage.output_tokens,
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
  // await row.update(input);
  // return row;
};

exports.deleteMessage = async (id) => {
  const count = await Message.destroy({ where: { id } });
  return count > 0;
};
