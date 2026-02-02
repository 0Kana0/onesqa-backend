// controllers/message.controller.js
const fs = require("fs");
const path = require("path");

const { Op } = require("sequelize");
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { geminiChat, uploadAndWait } = require("../function/gemini");
const { openAiChat, transcribeAudio } = require("../function/openai");
const { extractTextFromWord } = require("../utils/wordConvert");
const { extractTextFromExcel } = require("../utils/excelConvert");
const { extractTextFromPDF } = require("../utils/pdfConvert.js");
const { extractTextFromPowerPoint } = require("../utils/powerPointConvert.js");
const { deleteMultipleFiles } = require("../utils/fileUtils");
const { removeFirstPrefix, dataUri } = require("../utils/filename.js");
const { convertWebmToMp3 } = require("../utils/convertWebmToMp3");
const { checkTokenQuota } = require("../utils/checkTokenQuota");
const { updateTokenAndNotify } = require("../utils/updateTokenAndNotify");
const { upsertDailyUserToken } = require("../utils/upsertDailyUserToken.js");
const { saveFilesToDb } = require("../utils/saveFilesToDb.js");
const { geminiGenerateImage } = require("../function/gemini-image.js");
const { openaiGenerateImage } = require("../function/openai-image");
const { geminiGenerateExcel } = require("../function/gemini-doc.js");
const { setUserDailyActive } = require("../utils/userActive.js");
const { geminiGenerateVideo } = require("../function/gemini-video.js");
const { Message, Chat, Ai, File, User_ai, User, User_role, Chatgroup, Rag_chunk } = db;
const { ensureIndexedFilesForChat, retrieveContext, deleteRagByFileNames } = require("../utils/rag/ragService");
const { openaiGenerateVideo } = require("../function/openai-video.js");
const { openaiGenerateExcel } = require("../function/openai-doc.js");

const SEARCH_BLOCK_EXTS = new Set([
  ".pdf",
  ".doc", ".docx",
  ".xls", ".xlsx",
  ".ppt", ".pptx",
  ".mp4",
]);

function hasSearchBlockingFiles(filenames = []) {
  return filenames.some((name) => {
    const ext = path.extname(String(name || "")).toLowerCase();
    return SEARCH_BLOCK_EXTS.has(ext);
  });
}

exports.listMessages = async ({ chat_id, user_id }) => {
  const include = [
    // ✅ ใช้ Chat เพื่อกรองตาม user_id (ถ้ามี)
    {
      model: Chat,
      as: "chat",
      attributes: [], // ไม่ต้องดึง field ของ chat มา แค่ใช้กรอง
      required: user_id != null, // ถ้ามี user_id ให้บังคับ join เพื่อกรอง
      ...(user_id != null ? { where: { user_id } } : {}),
    },

    // ✅ files ของ message
    {
      model: File,
      as: "files",
      attributes: ["id", "file_name", "original_name", "stored_path"],
      required: false, // แนะนำ false เพื่อให้ message ที่ไม่มีไฟล์ก็ยังออก
      separate: true,
    },
  ];

  setUserDailyActive(user_id, "ACTIVE")

  return await Message.findAll({
    where: { chat_id },
    order: [["id", "ASC"]],
    include,
  });
};

exports.getMessageById = async (id) => {
  const findMessage = await Message.findByPk(id);
  const findChat = await Chat.findByPk(findMessage.chat_id);

  setUserDailyActive(findChat?.user_id, "ACTIVE")

  return findMessage
};

exports.createMessage = async (input, ctx) => {
  const { message_type, chat_id, message, fileMessageList, locale } = input;
  console.log(message_type, chat_id, message, fileMessageList, locale);

  // เวลาปัจจุบันของประเทศไทย
  const nowTH = new Date().toLocaleString(
    locale === "th" ? "th-TH" : "en-US",
    {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }
  );

  // เรียกดูข้อมูลของ chat เพื่อดูว่าใช้ model อันไหน
  const chatOne = await Chat.findByPk(chat_id, {
    include: [
      {
        model: Ai,
        as: "ai", // ต้องตรงกับ alias ใน association
      },
      {
        model: User,
        as: "user", // ต้องตรงกับ alias ใน association
        include: [
          {
            model: User_ai,
            as: "user_ai", // ต้องตรงกับ alias ใน association
            required: false,
          },
        ],
      },
    ],
  });

  // หา model ที่ต้องใช้จริงของ message นี้
  const findRealModel = await Ai.findOne({
    where: {
      model_type: chatOne.ai.model_type,
      message_type: "TEXT"
    }
  })
  console.log("findRealModel", findRealModel);

  // ห้ามส่งคำถามถ้าเหลือ token ของ user ทั้งหมดเหลือไม่ถึง 15%
  await checkTokenQuota({
    aiId: findRealModel?.id,
    userId: chatOne?.user_id,
    // minPercent: 15, // ไม่ส่งก็ได้ ใช้ค่า default
    ctx
  });

  // นำชื่อไฟล์ที่อัพโหลดเก็บเข้าไปใน array
  const list = Array.isArray(fileMessageList) ? fileMessageList : [];

  console.log("fileMessageList", fileMessageList);

  const fileMessageList_name = list.map(x => x?.filename).filter(Boolean);
  const fileMessageList_id   = list.map(x => x?.id).filter(v => v != null);

  console.log("fileMessageList_name", fileMessageList_name);
  console.log("fileMessageList_id", fileMessageList_id);

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
            const imgBase64 = fs.readFileSync(filePath, { encoding: "base64" });

            return {
              inlineData: {
                data: imgBase64,
                mimeType: `image/${tranext}`,
              },
            };

            // // เเปลงเป็น base64
            // const imgBase64 = await uploadAndWait(filePath, `image/${tranext}`, filename);

            // return {
            //   fileData: {
            //     fileUri: imgBase64.uri,
            //     mimeType: imgBase64.mimeType,
            //   },
            // };
            
            // ถ้าไฟล์เป็น pdf
          } else if (ext === ".pdf") {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ pdf ให้เป็น text + images
            const { text, images } = await extractTextFromPDF(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const pdfParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ PDF: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก PDF
            ];
            
            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.data,                       // base64 string
                mimeType: img.mimeType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...pdfParts, ...imageParts];

            // // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            // const filePath = path.join(__dirname, "../uploads", filename);
            // console.log(filePath);

            // // แปลงไฟล์ pdf ให้เป็น text
            // const pdfText = await uploadAndWait(filePath, "application/pdf", filename);
            // //console.log(pdfText);

            // return {
            //   fileData: {
            //     fileUri: pdfText.uri,
            //     mimeType: pdfText.mimeType,
            //   },
            // };

          // ถ้าไฟล์เป็น word
          } else if ([".doc", ".docx"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ word ให้เป็น text + images
            const { text, images } = await extractTextFromWord(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const wordParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ Word: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก Word
            ];
            
            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.base64,                       // base64 string
                mimeType: img.contentType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...wordParts, ...imageParts];

          // ถ้าไฟล์เป็น excel
          } else if ([".xlsx", ".xls"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ excel ให้เป็น text + images
            const { text, images } = await extractTextFromExcel(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const excelParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ Excel: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก Excel
            ];

            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.base64,                       // base64 string
                mimeType: img.mimeType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...excelParts, ...imageParts];

          } else if ([".pptx", ".ppt"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ powerpoint ให้เป็น text + images
            const { text, images } = await extractTextFromPowerPoint(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const powerPointParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ power point: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก PowerPoint
            ];
            
            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.base64,                       // base64 string
                mimeType: img.contentType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...powerPointParts, ...imageParts];

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
          } else if ([".webm"].includes(ext)) {
            
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath_old = path.join(__dirname, "../uploads", filename);
            console.log(filePath_old);

            const { fileName, mimeType, filePath } = await convertWebmToMp3(filename, filePath_old);
            //console.log(fileName, mimeType, filePath);
            
            // แปลงไฟล์ mp3, mp4
            const videoText = await uploadAndWait(filePath, `audio/mp3`, fileName);
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
      return mapped
      .flatMap((x) => (Array.isArray(x) ? x : [x]))
      .filter((x) => x != null);
    }

    // สร้าง array สำหรับเก็บ prompt ที่ผ่านมาโดยมี prompt ตั้งต้น
    // locale: "th" | "en"
    // ข้อความตามภาษา
    const systemPrompt =
      locale === "th"
        ? `คุณคือผู้ช่วยส่วนตัว วันที่และเวลาปัจจุบันของประเทศไทยคือ ${nowTH}`
        : `You are a personal assistant. The current date and time in Thailand is ${nowTH}`;

    const modelReply =
      locale === "th"
        ? "รับทราบครับ ผมจะทำหน้าที่เป็นผู้ช่วยของคุณ"
        : "Acknowledged. I will act as your personal assistant.";

    // history สำหรับส่งเข้า gemini
    const historyList = [
      {
        role: "user",
        parts: [{ text: systemPrompt }],
      },
      {
        role: "model",
        parts: [{ text: modelReply }],
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

    // รวมชื่อไฟล์จาก history + ล่าสุด
    const historyFileNames = (messageAllByChatId || [])
      .flatMap(m => (m.files || []).map(f => f.file_name).filter(Boolean));

    const enableGoogleSearch = !hasSearchBlockingFiles([
      ...historyFileNames,
      ...fileMessageList_name,
    ]);

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { text, response } = await geminiChat(
      messageList,
      historyList,
      findRealModel?.model_name,
      { enableGoogleSearch } // ✅ ถ้ามี pdf/doc/xls/ppt/mp4 ใน history/ล่าสุด => ปิด googleSearch
    );
    console.log("text", text);
    console.log("response", response);

    // อัพเดทเฉพาะ updatedAt ของ chat
    // touch updatedAt อย่างเดียว
    const chatgroupData = await Chatgroup.findByPk(chatOne.chatgroup_id);
    if (chatgroupData) {
      await Chatgroup.update(
        { chatgroup_name: chatgroupData.chatgroup_name },
        { where: { id: chatOne.chatgroup_id } }
      );
    }
    await Chat.update(
      { chat_name: chatOne.chat_name },
      { where: { id: chat_id } }
    );

    // เก็บคำถามลงใน db
    try {
      const sendData = await Message.create({
        role: "user",
        message_type: message_type,
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
        message_type: message_type,
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
    
    try {
      await upsertDailyUserToken({
        aiId: findRealModel?.id,
        userId: chatOne?.user_id,
        response,
      });
    } catch (error) {
      console.log(error);
    }

    const usedTokens = response?.usageMetadata?.totalTokenCount ?? 0;

    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model
    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
    try {
      // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
      await updateTokenAndNotify({
        ctx,
        chatOne,
        findRealModel,
        usedTokens,
        // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
        // transaction: t,       // ถ้ามี transaction อยู่ใน scope
      });

    } catch (error) {
      console.log(error);
    }

    return {
      text: text,
    };

    // ถ้าใช้ openai
  } else if (chatOne.ai.model_type === "gpt") {
    // function สำหรับแปลงไฟล์เป็นข้อมูลสำหรับส่งไป model
    async function processFiles(fileArray) {
      const mapped = await Promise.all(
        fileArray.map(async (filename) => {
          const ext = path.extname(filename).toLowerCase();
          const filePath = path.join(__dirname, "../uploads", filename);

          // ✅ ส่งเฉพาะรูปภาพที่ user อัปโหลดจริง
          if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
            const mime =
              ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
              ext === ".webp" ? "image/webp" : "image/png";

            const b64 = fs.readFileSync(filePath, { encoding: "base64" });
            return { type: "input_image", image_url: dataUri(mime, b64) };
          }

          // ❌ เอกสาร/วิดีโอ ไม่ส่งเป็น text เข้า prompt แล้ว (ไป RAG)
          return null;
        })
      );

      return mapped.filter(Boolean);
    }

    // สร้าง array สำหรับเก็บ prompt ที่ผ่านมาโดยมี prompt ตั้งต้น
    // locale: "th" | "en"
    // system prompt ตามภาษา
    const systemText =
      locale === "th"
        ? `คุณคือผู้ช่วยส่วนตัว วันที่และเวลาปัจจุบันของประเทศไทยคือ ${nowTH}`
        : `You are a personal assistant. The current date and time in Thailand is ${nowTH}`;

    // history สำหรับ gpt API
    const historyList = [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: systemText,
          },
        ],
      },
    ];

    // เก็บ prompt ที่ผ่านมาทั้งหมดใน array
    for (const message of messageAllByChatId) {
      const file_history = message?.files.map(x => x?.file_name).filter(Boolean);      
      const fileParts = await processFiles(file_history);

      const isAssistant = message.role === "assistant";
      const history = {
        role: message.role,
        content: [
          {
            type: isAssistant ? "output_text" : "input_text",
            text: message.text,
          },
          // สำหรับส่งไฟล์ไปที่ model
          ...fileParts
        ],
      };
      historyList.push(history);
    }

    // รวมชื่อไฟล์จาก history (ที่ดึงมาจาก DB) + ไฟล์ล่าสุดที่ผู้ใช้แนบมา
    const historyFileNames = (messageAllByChatId || [])
      .flatMap(m => (m.files || []).map(f => f.file_name).filter(Boolean));

    const allFileNamesForSearch = [
      ...historyFileNames,
      ...fileMessageList_name,
    ];

    // 1) รวมไฟล์ทั้งหมดใน chat (history + ล่าสุด)
    const allFileNames = [...new Set([...historyFileNames, ...fileMessageList_name])];

    // 2) map file_name -> File row (id) เพื่อ index ได้
    const fileRows = await File.findAll({
      where: { file_name: { [Op.in]: allFileNames } },
      attributes: ["id", "file_name"],
      raw: true,
    });

    // 3) ensure index เฉพาะไฟล์ที่ต้องทำ RAG (.pdf/.docx/.xlsx/.pptx/.mp4)
    await ensureIndexedFilesForChat({
      db,
      chatId: chat_id,
      files: fileRows,
      extractors: {
        extractTextFromPDF,
        extractTextFromWord,
        extractTextFromExcel,
        extractTextFromPowerPoint,
      },
      transcribeAudio,
    });

    // 4) retrieve context topK (จำกัดเฉพาะไฟล์ใน chat นี้)
    const fileIdsInChat = fileRows.map(x => x.id);
    const { contextText } = await retrieveContext({
      db,
      chatId: chat_id,
      fileIds: fileIdsInChat,
      query: message,
      topK: 60,
    });

    // 5) สร้าง context part (ถ้าเจอ)
    const ragPart = contextText
      ? { type: "input_text", text: `CONTEXT (from uploaded files):\n${contextText}` }
      : null;

    // เก็บคำถามล่าสุดที่ถามใน array
    const filteredFiles = await processFiles(fileMessageList_name);
    const messagePrompt = {
      role: "user",
      content: [
        ...(ragPart ? [ragPart] : []),
        { type: "input_text", text: message },
        ...filteredFiles,
      ],
    };

    historyList.push(messagePrompt);
    const out =
      typeof messagePrompt === "string"
        ? messagePrompt
        : JSON.stringify(messagePrompt, null, 2);

    //fs.writeFileSync("messagePrompt.log", out, "utf8");
    //console.log("✅ wrote messagePrompt.log");

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { text, response, enableSearch } = await openAiChat(
      historyList,
      findRealModel?.model_name,
      { fileNames: allFileNamesForSearch }   // ✅ สำคัญ
    );
    console.log("text", text);
    console.log("response", response);

    // อัพเดทเฉพาะ updatedAt ของ chat
    // touch updatedAt อย่างเดียว
    const chatgroupData = await Chatgroup.findByPk(chatOne.chatgroup_id);
    if (chatgroupData) {
      await Chatgroup.update(
        { chatgroup_name: chatgroupData.chatgroup_name },
        { where: { id: chatOne.chatgroup_id } }
      );
    }
    await Chat.update(
      { chat_name: chatOne.chat_name },
      { where: { id: chat_id } }
    );

    // เก็บคำถามลงใน db
    try {
      const sendData = await Message.create({
        role: "user",
        message_type: message_type,
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
        role: "assistant",
        message_type: message_type,
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

    try {
      await upsertDailyUserToken({
        aiId: findRealModel?.id,
        userId: chatOne?.user_id,
        response,
      });
    } catch (error) {
      console.log(error);
    }

    const usedTokens = response.usage.total_tokens ?? 0;

    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model
    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
    try {
      // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
      await updateTokenAndNotify({
        ctx,
        chatOne,
        findRealModel,
        usedTokens,
        // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
        // transaction: t,       // ถ้ามี transaction อยู่ใน scope
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

exports.createMessageImage = async (input, ctx) => {
  const { message_type, chat_id, message, locale } = input;
  console.log(message_type, chat_id, message, locale);

  // เวลาปัจจุบันของประเทศไทย
  const nowTH = new Date().toLocaleString(
    locale === "th" ? "th-TH" : "en-US",
    {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }
  );

  // เรียกดูข้อมูลของ chat เพื่อดูว่าใช้ model อันไหน
  const chatOne = await Chat.findByPk(chat_id, {
    include: [
      {
        model: Ai,
        as: "ai", // ต้องตรงกับ alias ใน association
      },
      {
        model: User,
        as: "user", // ต้องตรงกับ alias ใน association
        include: [
          {
            model: User_ai,
            as: "user_ai", // ต้องตรงกับ alias ใน association
            required: false,
          },
        ],
      },
    ],
  });
  
  // หา model ที่ต้องใช้จริงของ message นี้
  const findRealModel = await Ai.findOne({
    where: {
      model_type: chatOne.ai.model_type,
      message_type: "IMAGE"
    }
  })
  console.log("findRealModel", findRealModel);

  // ห้ามส่งคำถามถ้าเหลือ token ของ user ทั้งหมดเหลือไม่ถึง 15%
  await checkTokenQuota({
    aiId: findRealModel?.id,
    userId: chatOne?.user_id,
    // minPercent: 15, // ไม่ส่งก็ได้ ใช้ค่า default
    ctx
  });

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
            const imgBase64 = fs.readFileSync(filePath, { encoding: "base64" });

            return {
              inlineData: {
                data: imgBase64,
                mimeType: `image/${tranext}`,
              },
            };

            // // เเปลงเป็น base64
            // const imgBase64 = await uploadAndWait(filePath, `image/${tranext}`, filename);

            // return {
            //   fileData: {
            //     fileUri: imgBase64.uri,
            //     mimeType: imgBase64.mimeType,
            //   },
            // };
            
            // ถ้าไฟล์เป็น pdf
          } else if (ext === ".pdf") {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ pdf ให้เป็น text + images
            const { text, images } = await extractTextFromPDF(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const pdfParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ PDF: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก PDF
            ];
            
            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.data,                       // base64 string
                mimeType: img.mimeType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...pdfParts, ...imageParts];

            // // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            // const filePath = path.join(__dirname, "../uploads", filename);
            // console.log(filePath);

            // // แปลงไฟล์ pdf ให้เป็น text
            // const pdfText = await uploadAndWait(filePath, "application/pdf", filename);
            // //console.log(pdfText);

            // return {
            //   fileData: {
            //     fileUri: pdfText.uri,
            //     mimeType: pdfText.mimeType,
            //   },
            // };

          // ถ้าไฟล์เป็น word
          } else if ([".doc", ".docx"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ word ให้เป็น text + images
            const { text, images } = await extractTextFromWord(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const wordParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ Word: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก Word
            ];
            
            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.base64,                       // base64 string
                mimeType: img.contentType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...wordParts, ...imageParts];

          // ถ้าไฟล์เป็น excel
          } else if ([".xlsx", ".xls"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ excel ให้เป็น text + images
            const { text, images } = await extractTextFromExcel(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const excelParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ Excel: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก Excel
            ];

            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.base64,                       // base64 string
                mimeType: img.mimeType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...excelParts, ...imageParts];

          } else if ([".pptx", ".ppt"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ powerpoint ให้เป็น text + images
            const { text, images } = await extractTextFromPowerPoint(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const powerPointParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ power point: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก PowerPoint
            ];
            
            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.base64,                       // base64 string
                mimeType: img.contentType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...powerPointParts, ...imageParts];

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
          } else if ([".webm"].includes(ext)) {
            
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath_old = path.join(__dirname, "../uploads", filename);
            console.log(filePath_old);

            const { fileName, mimeType, filePath } = await convertWebmToMp3(filename, filePath_old);
            //console.log(fileName, mimeType, filePath);
            
            // แปลงไฟล์ mp3, mp4
            const videoText = await uploadAndWait(filePath, `audio/mp3`, fileName);
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
      return mapped
      .flatMap((x) => (Array.isArray(x) ? x : [x]))
      .filter((x) => x != null);
    }

    // สร้าง array สำหรับเก็บ prompt ที่ผ่านมาโดยมี prompt ตั้งต้น
    // locale: "th" | "en"
    // ข้อความตามภาษา
    const systemPrompt =
      locale === "th"
        ? `คุณคือผู้ช่วยส่วนตัว วันที่และเวลาปัจจุบันของประเทศไทยคือ ${nowTH}`
        : `You are a personal assistant. The current date and time in Thailand is ${nowTH}`;

    const modelReply =
      locale === "th"
        ? "รับทราบครับ ผมจะทำหน้าที่เป็นผู้ช่วยของคุณ"
        : "Acknowledged. I will act as your personal assistant.";

    // history สำหรับส่งเข้า gemini
    const historyList = [
      {
        role: "user",
        parts: [{ text: systemPrompt }],
      },
      {
        role: "model",
        parts: [{ text: modelReply }],
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
    const messageList = [
      { text: message },
    ];
    console.log(messageList);

    const { files, response } = await geminiGenerateImage(
      historyList,
      messageList,
      {
        model: findRealModel?.model_name,
        aspectRatio: "1:1",
        outDir: "./uploads",
        fileBase: `${Date.now()}-gen-image`,
      }
    );

    console.log(response);
    console.log("saved:", files);

    // อัพเดทเฉพาะ updatedAt ของ chat
    // touch updatedAt อย่างเดียว
    const chatgroupData = await Chatgroup.findByPk(chatOne.chatgroup_id);
    if (chatgroupData) {
      await Chatgroup.update(
        { chatgroup_name: chatgroupData.chatgroup_name },
        { where: { id: chatOne.chatgroup_id } }
      );
    }
    await Chat.update(
      { chat_name: chatOne.chat_name },
      { where: { id: chat_id } }
    );

    // เก็บรูปที่สร้างลงใน db
    const createdFiles = await saveFilesToDb({
      files,                 // array paths จาก generator
      FileModel: File,       // Sequelize model
      uploadUrlPrefix: "/uploads",
      folder: "",
      messageId: null,       // หรือใส่ answerData.id ถ้ารู้แล้ว
    });

    console.log("saved to db:", createdFiles.map(x => x.id));
    // createdFiles คือ array ของ File model ที่คุณสร้างไว้
    const fileIdsNum = createdFiles.map(x => x.id);
    const fileIdsStr = fileIdsNum.map(String);

    // เก็บคำถามลงใน db
    try {
      await Message.create({
        role: "user",
        message_type: message_type,
        text: message,
        file: [],
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
      const answerData = await Message.create({
        role: "model",
        message_type: message_type,
        text: "",
        file: fileIdsStr,
        input_token: response.usageMetadata.promptTokenCount,
        output_token:
          (response?.usageMetadata?.candidatesTokenCount ?? 0) +
          (response?.usageMetadata?.thoughtsTokenCount ?? 0) +
          (response?.usageMetadata?.toolUsePromptTokenCount ?? 0),
        total_token: response.usageMetadata.totalTokenCount,
        chat_id: chat_id,
      });

      for (const item of createdFiles.map(x => x.id)) {
        await File.update({
          message_id: answerData.id
        }, {where: {id: item}})
      }
    } catch (error) {
      console.log(error);
    }

    try {
      await upsertDailyUserToken({
        aiId: findRealModel?.id,
        userId: chatOne?.user_id,
        response,
      });
    } catch (error) {
      console.log(error);
    }

    const usedTokens = response?.usageMetadata?.totalTokenCount ?? 0;

    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model
    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
    try {
      // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
      await updateTokenAndNotify({
        ctx,
        chatOne,
        findRealModel,
        usedTokens,
        // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
        // transaction: t,       // ถ้ามี transaction อยู่ใน scope
      });

    } catch (error) {
      console.log(error);
    }

    return {
      text: "Gen Image Success",
    };

    // ถ้าใช้ openai
  } else if (chatOne.ai.model_type === "gpt") {
    // function สำหรับแปลงไฟล์เป็นข้อมูลสำหรับส่งไป model
    async function processFiles(fileArray) {
      const mapped = await Promise.all(
        fileArray.map(async (filename) => {
          const ext = path.extname(filename).toLowerCase();
          const filePath = path.join(__dirname, "../uploads", filename);

          // ---------- รูปภาพ ----------
          if ([".png", ".jpg", ".jpeg"].includes(ext)) {
            const mime =
              ext === ".jpg" ? "image/jpeg" :
              ext === ".jpeg" ? "image/jpeg" :
              ext === ".webp" ? "image/webp" : "image/png";
            const b64 = fs.readFileSync(filePath, { encoding: "base64" });

            return {
              type: "input_image",
              image_url: dataUri(mime, b64),
            };
          }
          // ---------- PDF ----------
          if (ext === ".pdf") {
            const { text, images } = await extractTextFromPDF(filePath);
            const parts = [
              { type: "input_text", text: `นี่คือเนื้อหาจากไฟล์ PDF: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: text || "(ไม่พบข้อความใน PDF)" },
            ];

            // images: [{ data: <base64>, mimeType?: "image/png" }]
            (images || []).forEach((img) => {
              const mime = img?.mimeType || "image/png";
              parts.push({
                type: "input_image",
                image_url: dataUri(mime, img.data),
              });
            });

            return parts;
          }
          // ---------- Word ----------
          if ([".doc", ".docx"].includes(ext)) {
            const { text, images } = await extractTextFromWord(filePath);
            const parts = [
              { type: "input_text", text: `นี่คือเนื้อหาจากไฟล์ Word: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: text || "(ไม่พบข้อความใน Word)" },
            ];

            // images: [{ base64: <string>, contentType?: "image/png" }]
            (images || []).forEach((img) => {
              const mime = img?.contentType || "image/png";
              parts.push({
                type: "input_image",
                image_url: dataUri(mime, img.base64),
              });
            });

            return parts;
          }
          // ---------- Excel ----------
          if ([".xlsx", ".xls"].includes(ext)) {
            const { text, images } = await extractTextFromExcel(filePath);
            const parts = [
              { type: "input_text", text: `นี่คือเนื้อหาจากไฟล์ Excel: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: text || "(ไม่พบข้อความใน Excel)" },
            ];

            // images: [{ base64: <string>, mimeType?: "image/png" }]
            (images || []).forEach((img) => {
              const mime = img?.mimeType || "image/png";
              parts.push({
                type: "input_image",
                image_url: dataUri(mime, img.base64),
              });
            });

            return parts;
          }
          // ---------- PowerPoint ----------
          if ([".pptx", ".ppt"].includes(ext)) {
            const { text, images } = await extractTextFromPowerPoint(filePath);
            const parts = [
              { type: "input_text", text: `นี่คือเนื้อหาจากไฟล์ PowerPoint: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: text || "(ไม่พบข้อความใน PowerPoint)" },
            ];

            // images: [{ base64: <string>, contentType?: "image/png" }]
            (images || []).forEach((img) => {
              const mime = img?.contentType || "image/png";
              parts.push({
                type: "input_image",
                image_url: dataUri(mime, img.base64),
              });
            });

            return parts;
          }
          // ---- MP3 (เสียง) ----
          if (ext === ".mp3") {
            const filePath = path.join(__dirname, "../uploads", filename);
            const transcript = await transcribeAudio(filePath);
            return [
              { type: "input_text", text: `ถอดเสียงจากไฟล์: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: transcript || "(ไม่พบข้อความจากการถอดเสียง)" },
            ];
          } 
          // ---- MP4 (วิดีโอ) ----
          if (ext === ".mp4") {
            const filePath = path.join(__dirname, "../uploads", filename);
            // ส่งเสียงไปถอดเป็นข้อความได้เลย (mp4 รองรับใน Transcriptions)
            const transcript = await transcribeAudio(filePath);
            return [
              { type: "input_text", text: `สรุปจากวิดีโอ: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: transcript || "(ไม่พบข้อความจากการถอดเสียงวิดีโอ)" },
            ];
          } 

          // ไม่รองรับ
          return null;
        })
      );

      // flatten + กรอง null
      return mapped.flat().filter(Boolean);
    }

    // สร้าง array สำหรับเก็บ prompt ที่ผ่านมาโดยมี prompt ตั้งต้น
    // locale: "th" | "en"
    // system prompt ตามภาษา
    const systemText =
      locale === "th"
        ? `คุณคือผู้ช่วยส่วนตัว วันที่และเวลาปัจจุบันของประเทศไทยคือ ${nowTH}`
        : `You are a personal assistant. The current date and time in Thailand is ${nowTH}`;

    // history สำหรับ gpt API
    const historyList = [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: systemText,
          },
        ],
      },
    ];

    // เก็บ prompt ที่ผ่านมาทั้งหมดใน array
    for (const message of messageAllByChatId) {
      const file_history = message?.files.map(x => x?.file_name).filter(Boolean);      
      const fileParts = await processFiles(file_history);

      const isAssistant = message.role === "assistant";
      const history = {
        role: message.role,
        content: [
          {
            type: isAssistant ? "output_text" : "input_text",
            text: message.text,
          },
          // สำหรับส่งไฟล์ไปที่ model
          ...fileParts
        ],
      };
      historyList.push(history);
    }

    // เก็บคำถามล่าสุดที่ถามใน array
    const messagePrompt = {
      role: "user",
      content: [
        { type: "input_text", text: message },
        // สำหรับส่งไฟล์ไปที่ model
      ],
    };

    historyList.push(messagePrompt);
    //console.log(historyList);

    const { files, response } = await openaiGenerateImage(historyList, {
      model: findRealModel?.model_name,
      aspectRatio: "1:1",
      outDir: "./uploads",
      fileBase: `${Date.now()}-gen-image`,
      n: 1,
    });

    console.log(response);
    console.log("saved:", files);

    // อัพเดทเฉพาะ updatedAt ของ chat
    // touch updatedAt อย่างเดียว
    const chatgroupData = await Chatgroup.findByPk(chatOne.chatgroup_id);
    if (chatgroupData) {
      await Chatgroup.update(
        { chatgroup_name: chatgroupData.chatgroup_name },
        { where: { id: chatOne.chatgroup_id } }
      );
    }
    await Chat.update(
      { chat_name: chatOne.chat_name },
      { where: { id: chat_id } }
    );

    // เก็บรูปที่สร้างลงใน db
    const createdFiles = await saveFilesToDb({
      files,                 // array paths จาก generator
      FileModel: File,       // Sequelize model
      uploadUrlPrefix: "/uploads",
      folder: "",
      messageId: null,       // หรือใส่ answerData.id ถ้ารู้แล้ว
    });

    console.log("saved to db:", createdFiles.map(x => x.id));
    // createdFiles คือ array ของ File model ที่คุณสร้างไว้
    const fileIdsNum = createdFiles.map(x => x.id);
    const fileIdsStr = fileIdsNum.map(String);

    // เก็บคำถามลงใน db
    try {
      await Message.create({
        role: "user",
        message_type: message_type,
        text: message,
        file: [],
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
      const answerData = await Message.create({
        role: "assistant",
        message_type: message_type,
        text: "",
        file: fileIdsStr,
        input_token: response.usage.input_tokens,
        output_token: response.usage.output_tokens,
        total_token: response.usage.total_tokens,
        chat_id: chat_id,
      });

      for (const item of createdFiles.map(x => x.id)) {
        await File.update({
          message_id: answerData.id
        }, {where: {id: item}})
      }
    } catch (error) {
      console.log(error);
    }

    try {
      await upsertDailyUserToken({
        aiId: findRealModel?.id,
        userId: chatOne?.user_id,
        response,
      });
    } catch (error) {
      console.log(error);
    }

    const usedTokens = response.usage.total_tokens ?? 0;

    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model
    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
    try {
      // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
      await updateTokenAndNotify({
        ctx,
        chatOne,
        findRealModel,
        usedTokens,
        // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
        // transaction: t,       // ถ้ามี transaction อยู่ใน scope
      });

    } catch (error) {
      console.log(error);
    }

    return {
      text: "Gen Image Success",
    };
  }

  // const messageList = [
  //   { text: "ภาพตัวละครอนิเมะ saber จาก fate grand order" },
  // ];

  // const { files, response } = await geminiGenerateImage(
  //   [],
  //   messageList,
  //   {
  //     model: "gemini-3-pro-image-preview",
  //     aspectRatio: "1:1",
  //     outDir: "./uploads",
  //     fileBase: `${Date.now()}-gen-image`,
  //   }
  // );

  // console.log(response);
  // console.log("saved:", files);
}

exports.createMessageVideo = async (input, ctx) => {
  const { message_type, chat_id, message, locale } = input;
  console.log(message_type, chat_id, message, locale);

  // เวลาปัจจุบันของประเทศไทย
  const nowTH = new Date().toLocaleString(
    locale === "th" ? "th-TH" : "en-US",
    {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }
  );

  // เรียกดูข้อมูลของ chat เพื่อดูว่าใช้ model อันไหน
  const chatOne = await Chat.findByPk(chat_id, {
    include: [
      {
        model: Ai,
        as: "ai", // ต้องตรงกับ alias ใน association
      },
      {
        model: User,
        as: "user", // ต้องตรงกับ alias ใน association
        include: [
          {
            model: User_ai,
            as: "user_ai", // ต้องตรงกับ alias ใน association
            required: false,
          },
        ],
      },
    ],
  });
  
  // หา model ที่ต้องใช้จริงของ message นี้
  const findRealModel = await Ai.findOne({
    where: {
      model_type: chatOne.ai.model_type,
      message_type: "VIDEO"
    }
  })
  console.log("findRealModel", findRealModel);

  // ห้ามส่งคำถามถ้าเหลือ token ของ user ทั้งหมดเหลือไม่ถึง 15%
  await checkTokenQuota({
    aiId: findRealModel?.id,
    userId: chatOne?.user_id,
    // minPercent: 15, // ไม่ส่งก็ได้ ใช้ค่า default
    ctx
  });

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
            const imgBase64 = fs.readFileSync(filePath, { encoding: "base64" });

            return {
              inlineData: {
                data: imgBase64,
                mimeType: `image/${tranext}`,
              },
            };

            // // เเปลงเป็น base64
            // const imgBase64 = await uploadAndWait(filePath, `image/${tranext}`, filename);

            // return {
            //   fileData: {
            //     fileUri: imgBase64.uri,
            //     mimeType: imgBase64.mimeType,
            //   },
            // };
            
            // ถ้าไฟล์เป็น pdf
          } else if (ext === ".pdf") {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ pdf ให้เป็น text + images
            const { text, images } = await extractTextFromPDF(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const pdfParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ PDF: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก PDF
            ];
            
            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.data,                       // base64 string
                mimeType: img.mimeType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...pdfParts, ...imageParts];

            // // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            // const filePath = path.join(__dirname, "../uploads", filename);
            // console.log(filePath);

            // // แปลงไฟล์ pdf ให้เป็น text
            // const pdfText = await uploadAndWait(filePath, "application/pdf", filename);
            // //console.log(pdfText);

            // return {
            //   fileData: {
            //     fileUri: pdfText.uri,
            //     mimeType: pdfText.mimeType,
            //   },
            // };

          // ถ้าไฟล์เป็น word
          } else if ([".doc", ".docx"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ word ให้เป็น text + images
            const { text, images } = await extractTextFromWord(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const wordParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ Word: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก Word
            ];
            
            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.base64,                       // base64 string
                mimeType: img.contentType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...wordParts, ...imageParts];

          // ถ้าไฟล์เป็น excel
          } else if ([".xlsx", ".xls"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ excel ให้เป็น text + images
            const { text, images } = await extractTextFromExcel(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const excelParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ Excel: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก Excel
            ];

            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.base64,                       // base64 string
                mimeType: img.mimeType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...excelParts, ...imageParts];

          } else if ([".pptx", ".ppt"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ powerpoint ให้เป็น text + images
            const { text, images } = await extractTextFromPowerPoint(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const powerPointParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ power point: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก PowerPoint
            ];
            
            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.base64,                       // base64 string
                mimeType: img.contentType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...powerPointParts, ...imageParts];

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
          } else if ([".webm"].includes(ext)) {
            
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath_old = path.join(__dirname, "../uploads", filename);
            console.log(filePath_old);

            const { fileName, mimeType, filePath } = await convertWebmToMp3(filename, filePath_old);
            //console.log(fileName, mimeType, filePath);
            
            // แปลงไฟล์ mp3, mp4
            const videoText = await uploadAndWait(filePath, `audio/mp3`, fileName);
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
      return mapped
      .flatMap((x) => (Array.isArray(x) ? x : [x]))
      .filter((x) => x != null);
    }

    // สร้าง array สำหรับเก็บ prompt ที่ผ่านมาโดยมี prompt ตั้งต้น
    // locale: "th" | "en"
    // ข้อความตามภาษา
    const systemPrompt =
      locale === "th"
        ? `คุณคือผู้ช่วยส่วนตัว วันที่และเวลาปัจจุบันของประเทศไทยคือ ${nowTH}`
        : `You are a personal assistant. The current date and time in Thailand is ${nowTH}`;

    const modelReply =
      locale === "th"
        ? "รับทราบครับ ผมจะทำหน้าที่เป็นผู้ช่วยของคุณ"
        : "Acknowledged. I will act as your personal assistant.";

    // history สำหรับส่งเข้า gemini
    const historyList = [
      {
        role: "user",
        parts: [{ text: systemPrompt }],
      },
      {
        role: "model",
        parts: [{ text: modelReply }],
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
    const messageList = [
      { text: message },
    ];
    console.log(messageList);

    const { files, response, tokens, input_token, output_token } = await geminiGenerateVideo(
      historyList,
      messageList,
      {
        model: findRealModel?.model_name,
        outDir: "./uploads",
        fileBase: `${Date.now()}-gen-video`,
      }
    );

    console.log(response[0]?.generatedVideos);
    console.log("saved:", files);

    // อัพเดทเฉพาะ updatedAt ของ chat
    // touch updatedAt อย่างเดียว
    const chatgroupData = await Chatgroup.findByPk(chatOne.chatgroup_id);
    if (chatgroupData) {
      await Chatgroup.update(
        { chatgroup_name: chatgroupData.chatgroup_name },
        { where: { id: chatOne.chatgroup_id } }
      );
    }
    await Chat.update(
      { chat_name: chatOne.chat_name },
      { where: { id: chat_id } }
    );

    // เก็บรูปที่สร้างลงใน db
    const createdFiles = await saveFilesToDb({
      files,                 // array paths จาก generator
      FileModel: File,       // Sequelize model
      uploadUrlPrefix: "/uploads",
      folder: "",
      messageId: null,       // หรือใส่ answerData.id ถ้ารู้แล้ว
    });

    console.log("saved to db:", createdFiles.map(x => x.id));
    // createdFiles คือ array ของ File model ที่คุณสร้างไว้
    const fileIdsNum = createdFiles.map(x => x.id);
    const fileIdsStr = fileIdsNum.map(String);

    // เก็บคำถามลงใน db
    try {
      await Message.create({
        role: "user",
        message_type: message_type,
        text: message,
        file: [],
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
      const answerData = await Message.create({
        role: "model",
        message_type: message_type,
        text: "",
        file: fileIdsStr,
        input_token: 0,
        output_token: 0,
        total_token: 0,
        chat_id: chat_id,
      });

      for (const item of createdFiles.map(x => x.id)) {
        await File.update({
          message_id: answerData.id
        }, {where: {id: item}})
      }
    } catch (error) {
      console.log(error);
    }

    try {
      await upsertDailyUserToken({
        aiId: findRealModel?.id,
        userId: chatOne?.user_id,
        response,
      });
    } catch (error) {
      console.log(error);
    }

    //const usedTokens = response?.usageMetadata?.totalTokenCount ?? 0;
    const usedTokens = 0;

    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model
    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
    try {
      // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
      await updateTokenAndNotify({
        ctx,
        chatOne,
        findRealModel,
        usedTokens,
        // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
        // transaction: t,       // ถ้ามี transaction อยู่ใน scope
      });

    } catch (error) {
      console.log(error);
    }

    return {
      text: "Gen Video Success",
    };

    // ถ้าใช้ openai
  } else if (chatOne.ai.model_type === "gpt") {
    // function สำหรับแปลงไฟล์เป็นข้อมูลสำหรับส่งไป model
    async function processFiles(fileArray) {
      const mapped = await Promise.all(
        fileArray.map(async (filename) => {
          const ext = path.extname(filename).toLowerCase();
          const filePath = path.join(__dirname, "../uploads", filename);

          // ---------- รูปภาพ ----------
          if ([".png", ".jpg", ".jpeg"].includes(ext)) {
            const mime =
              ext === ".jpg" ? "image/jpeg" :
              ext === ".jpeg" ? "image/jpeg" :
              ext === ".webp" ? "image/webp" : "image/png";
            const b64 = fs.readFileSync(filePath, { encoding: "base64" });

            return {
              type: "input_image",
              image_url: dataUri(mime, b64),
            };
          }
          // ---------- PDF ----------
          if (ext === ".pdf") {
            const { text, images } = await extractTextFromPDF(filePath);
            const parts = [
              { type: "input_text", text: `นี่คือเนื้อหาจากไฟล์ PDF: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: text || "(ไม่พบข้อความใน PDF)" },
            ];

            // images: [{ data: <base64>, mimeType?: "image/png" }]
            (images || []).forEach((img) => {
              const mime = img?.mimeType || "image/png";
              parts.push({
                type: "input_image",
                image_url: dataUri(mime, img.data),
              });
            });

            return parts;
          }
          // ---------- Word ----------
          if ([".doc", ".docx"].includes(ext)) {
            const { text, images } = await extractTextFromWord(filePath);
            const parts = [
              { type: "input_text", text: `นี่คือเนื้อหาจากไฟล์ Word: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: text || "(ไม่พบข้อความใน Word)" },
            ];

            // images: [{ base64: <string>, contentType?: "image/png" }]
            (images || []).forEach((img) => {
              const mime = img?.contentType || "image/png";
              parts.push({
                type: "input_image",
                image_url: dataUri(mime, img.base64),
              });
            });

            return parts;
          }
          // ---------- Excel ----------
          if ([".xlsx", ".xls"].includes(ext)) {
            const { text, images } = await extractTextFromExcel(filePath);
            const parts = [
              { type: "input_text", text: `นี่คือเนื้อหาจากไฟล์ Excel: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: text || "(ไม่พบข้อความใน Excel)" },
            ];

            // images: [{ base64: <string>, mimeType?: "image/png" }]
            (images || []).forEach((img) => {
              const mime = img?.mimeType || "image/png";
              parts.push({
                type: "input_image",
                image_url: dataUri(mime, img.base64),
              });
            });

            return parts;
          }
          // ---------- PowerPoint ----------
          if ([".pptx", ".ppt"].includes(ext)) {
            const { text, images } = await extractTextFromPowerPoint(filePath);
            const parts = [
              { type: "input_text", text: `นี่คือเนื้อหาจากไฟล์ PowerPoint: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: text || "(ไม่พบข้อความใน PowerPoint)" },
            ];

            // images: [{ base64: <string>, contentType?: "image/png" }]
            (images || []).forEach((img) => {
              const mime = img?.contentType || "image/png";
              parts.push({
                type: "input_image",
                image_url: dataUri(mime, img.base64),
              });
            });

            return parts;
          }
          // ---- MP3 (เสียง) ----
          if (ext === ".mp3") {
            const filePath = path.join(__dirname, "../uploads", filename);
            const transcript = await transcribeAudio(filePath);
            return [
              { type: "input_text", text: `ถอดเสียงจากไฟล์: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: transcript || "(ไม่พบข้อความจากการถอดเสียง)" },
            ];
          } 
          // ---- MP4 (วิดีโอ) ----
          if (ext === ".mp4") {
            const filePath = path.join(__dirname, "../uploads", filename);
            // ส่งเสียงไปถอดเป็นข้อความได้เลย (mp4 รองรับใน Transcriptions)
            const transcript = await transcribeAudio(filePath);
            return [
              { type: "input_text", text: `สรุปจากวิดีโอ: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: transcript || "(ไม่พบข้อความจากการถอดเสียงวิดีโอ)" },
            ];
          } 

          // ไม่รองรับ
          return null;
        })
      );

      // flatten + กรอง null
      return mapped.flat().filter(Boolean);
    }

    // สร้าง array สำหรับเก็บ prompt ที่ผ่านมาโดยมี prompt ตั้งต้น
    // locale: "th" | "en"
    // system prompt ตามภาษา
    const systemText =
      locale === "th"
        ? `คุณคือผู้ช่วยส่วนตัว วันที่และเวลาปัจจุบันของประเทศไทยคือ ${nowTH}`
        : `You are a personal assistant. The current date and time in Thailand is ${nowTH}`;

    // history สำหรับ gpt API
    const historyList = [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: systemText,
          },
        ],
      },
    ];

    // เก็บ prompt ที่ผ่านมาทั้งหมดใน array
    for (const message of messageAllByChatId) {
      const file_history = message?.files.map(x => x?.file_name).filter(Boolean);      
      const fileParts = await processFiles(file_history);

      const isAssistant = message.role === "assistant";
      const history = {
        role: message.role,
        content: [
          {
            type: isAssistant ? "output_text" : "input_text",
            text: message.text,
          },
          // สำหรับส่งไฟล์ไปที่ model
          ...fileParts
        ],
      };
      historyList.push(history);
    }

    // เก็บคำถามล่าสุดที่ถามใน array
    const messagePrompt = {
      role: "user",
      content: [
        { type: "input_text", text: message },
        // สำหรับส่งไฟล์ไปที่ model
      ],
    };

    historyList.push(messagePrompt);
    //console.log(historyList);

    const { files, response } = await openaiGenerateVideo(historyList, {
      model: findRealModel?.model_name,
      seconds: 8,
      aspectRatio: "16:9",
      quality: "high",               // จะเลือก size ใหญ่ขึ้นอัตโนมัติ
      outDir: "./uploads",
      fileBase: `${Date.now()}-gen-video`,
      // inputReferencePath: "./uploads/start.png", // ถ้าต้องการบังคับภาพเริ่มต้นเอง
    });

    console.log(response.status); // completed
    console.log("saved:", files);

    // อัพเดทเฉพาะ updatedAt ของ chat
    // touch updatedAt อย่างเดียว
    const chatgroupData = await Chatgroup.findByPk(chatOne.chatgroup_id);
    if (chatgroupData) {
      await Chatgroup.update(
        { chatgroup_name: chatgroupData.chatgroup_name },
        { where: { id: chatOne.chatgroup_id } }
      );
    }
    await Chat.update(
      { chat_name: chatOne.chat_name },
      { where: { id: chat_id } }
    );

    // เก็บรูปที่สร้างลงใน db
    const createdFiles = await saveFilesToDb({
      files,                 // array paths จาก generator
      FileModel: File,       // Sequelize model
      uploadUrlPrefix: "/uploads",
      folder: "",
      messageId: null,       // หรือใส่ answerData.id ถ้ารู้แล้ว
    });

    console.log("saved to db:", createdFiles.map(x => x.id));
    // createdFiles คือ array ของ File model ที่คุณสร้างไว้
    const fileIdsNum = createdFiles.map(x => x.id);
    const fileIdsStr = fileIdsNum.map(String);

    // เก็บคำถามลงใน db
    try {
      await Message.create({
        role: "user",
        message_type: message_type,
        text: message,
        file: [],
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
      const answerData = await Message.create({
        role: "assistant",
        message_type: message_type,
        text: "",
        file: fileIdsStr,
        input_token: 0,
        output_token: 0,
        total_token: 0,
        chat_id: chat_id,
      });

      for (const item of createdFiles.map(x => x.id)) {
        await File.update({
          message_id: answerData.id
        }, {where: {id: item}})
      }
    } catch (error) {
      console.log(error);
    }

    try {
      await upsertDailyUserToken({
        aiId: findRealModel?.id,
        userId: chatOne?.user_id,
        response,
      });
    } catch (error) {
      console.log(error);
    }

    //const usedTokens = response.usage.total_tokens ?? 0;
    const usedTokens = 0;

    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model
    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
    try {
      // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
      await updateTokenAndNotify({
        ctx,
        chatOne,
        findRealModel,
        usedTokens,
        // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
        // transaction: t,       // ถ้ามี transaction อยู่ใน scope
      });

    } catch (error) {
      console.log(error);
    }

    return {
      text: "Gen Video Success",
    };
  }
}

exports.createMessageDoc = async (input, ctx) => {
  const { message_type, chat_id, message, locale } = input;
  console.log(message_type, chat_id, message, locale);
  
  // เวลาปัจจุบันของประเทศไทย
  const nowTH = new Date().toLocaleString(
    locale === "th" ? "th-TH" : "en-US",
    {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }
  );

  // เรียกดูข้อมูลของ chat เพื่อดูว่าใช้ model อันไหน
  const chatOne = await Chat.findByPk(chat_id, {
    include: [
      {
        model: Ai,
        as: "ai", // ต้องตรงกับ alias ใน association
      },
      {
        model: User,
        as: "user", // ต้องตรงกับ alias ใน association
        include: [
          {
            model: User_ai,
            as: "user_ai", // ต้องตรงกับ alias ใน association
            required: false,
          },
        ],
      },
    ],
  });

  // หา model ที่ต้องใช้จริงของ message นี้
  const findRealModel = await Ai.findOne({
    where: {
      model_type: chatOne.ai.model_type,
      message_type: "TEXT"
    }
  })
  console.log("findRealModel", findRealModel);

  // ห้ามส่งคำถามถ้าเหลือ token ของ user ทั้งหมดเหลือไม่ถึง 15%
  await checkTokenQuota({
    aiId: findRealModel?.id,
    userId: chatOne?.user_id,
    // minPercent: 15, // ไม่ส่งก็ได้ ใช้ค่า default
    ctx
  });

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
            const imgBase64 = fs.readFileSync(filePath, { encoding: "base64" });

            return {
              inlineData: {
                data: imgBase64,
                mimeType: `image/${tranext}`,
              },
            };

            // // เเปลงเป็น base64
            // const imgBase64 = await uploadAndWait(filePath, `image/${tranext}`, filename);

            // return {
            //   fileData: {
            //     fileUri: imgBase64.uri,
            //     mimeType: imgBase64.mimeType,
            //   },
            // };
            
            // ถ้าไฟล์เป็น pdf
          } else if (ext === ".pdf") {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ pdf ให้เป็น text + images
            const { text, images } = await extractTextFromPDF(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const pdfParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ PDF: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก PDF
            ];
            
            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.data,                       // base64 string
                mimeType: img.mimeType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...pdfParts, ...imageParts];

            // // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            // const filePath = path.join(__dirname, "../uploads", filename);
            // console.log(filePath);

            // // แปลงไฟล์ pdf ให้เป็น text
            // const pdfText = await uploadAndWait(filePath, "application/pdf", filename);
            // //console.log(pdfText);

            // return {
            //   fileData: {
            //     fileUri: pdfText.uri,
            //     mimeType: pdfText.mimeType,
            //   },
            // };

          // ถ้าไฟล์เป็น word
          } else if ([".doc", ".docx"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ word ให้เป็น text + images
            const { text, images } = await extractTextFromWord(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const wordParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ Word: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก Word
            ];
            
            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.base64,                       // base64 string
                mimeType: img.contentType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...wordParts, ...imageParts];

          // ถ้าไฟล์เป็น excel
          } else if ([".xlsx", ".xls"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ excel ให้เป็น text + images
            const { text, images } = await extractTextFromExcel(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const excelParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ Excel: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก Excel
            ];

            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.base64,                       // base64 string
                mimeType: img.mimeType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...excelParts, ...imageParts];

          } else if ([".pptx", ".ppt"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ powerpoint ให้เป็น text + images
            const { text, images } = await extractTextFromPowerPoint(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const powerPointParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ power point: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก PowerPoint
            ];
            
            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.base64,                       // base64 string
                mimeType: img.contentType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...powerPointParts, ...imageParts];

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
          } else if ([".webm"].includes(ext)) {
            
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath_old = path.join(__dirname, "../uploads", filename);
            console.log(filePath_old);

            const { fileName, mimeType, filePath } = await convertWebmToMp3(filename, filePath_old);
            //console.log(fileName, mimeType, filePath);
            
            // แปลงไฟล์ mp3, mp4
            const videoText = await uploadAndWait(filePath, `audio/mp3`, fileName);
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
      return mapped
      .flatMap((x) => (Array.isArray(x) ? x : [x]))
      .filter((x) => x != null);
    }

    // สร้าง array สำหรับเก็บ prompt ที่ผ่านมาโดยมี prompt ตั้งต้น
    // locale: "th" | "en"
    // ข้อความตามภาษา
    const systemPrompt =
      locale === "th"
        ? `คุณคือผู้ช่วยส่วนตัว วันที่และเวลาปัจจุบันของประเทศไทยคือ ${nowTH}`
        : `You are a personal assistant. The current date and time in Thailand is ${nowTH}`;

    const modelReply =
      locale === "th"
        ? "รับทราบครับ ผมจะทำหน้าที่เป็นผู้ช่วยของคุณ"
        : "Acknowledged. I will act as your personal assistant.";

    // history สำหรับส่งเข้า gemini
    const historyList = [
      {
        role: "user",
        parts: [{ text: systemPrompt }],
      },
      {
        role: "model",
        parts: [{ text: modelReply }],
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
    const messageList = [
      { text: message },
    ];
    console.log(messageList);

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { files, text, rawText, response } = await geminiGenerateExcel(
      messageList,
      historyList,
      {
        model: findRealModel?.model_name,
        outDir: "./uploads",
        fileBase: `${Date.now()}-gen-doc`,
      }
    );
    console.log("files", files);
    console.log("text", text);
    console.log("rawTex", rawText);
    console.log("response", response);

    // อัพเดทเฉพาะ updatedAt ของ chat
    // touch updatedAt อย่างเดียว
    const chatgroupData = await Chatgroup.findByPk(chatOne.chatgroup_id);
    if (chatgroupData) {
      await Chatgroup.update(
        { chatgroup_name: chatgroupData.chatgroup_name },
        { where: { id: chatOne.chatgroup_id } }
      );
    }
    await Chat.update(
      { chat_name: chatOne.chat_name },
      { where: { id: chat_id } }
    );

    // เก็บรูปที่สร้างลงใน db
    // เก็บไฟล์ที่สร้างลงใน db (รองรับ png/jpg/webp + xls/xlsx)
    const createdFiles = await saveFilesToDb({
      files,                 // array paths จาก generator
      FileModel: File,       // Sequelize model
      uploadUrlPrefix: "/uploads",
      folder: "",
      messageId: null,       // หรือใส่ answerData.id ถ้ารู้แล้ว
    });

    console.log("saved to db:", createdFiles.map(x => x.id));
    // createdFiles คือ array ของ File model ที่คุณสร้างไว้
    const fileIdsNum = createdFiles.map(x => x.id);
    const fileIdsStr = fileIdsNum.map(String);

    // เก็บคำถามลงใน db
    try {
      await Message.create({
        role: "user",
        message_type: message_type,
        text: message,
        file: [],
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
      const answerData = await Message.create({
        role: "model",
        message_type: message_type,
        text: "",
        file: fileIdsStr,
        input_token: response.usageMetadata.promptTokenCount,
        output_token:
          (response?.usageMetadata?.candidatesTokenCount ?? 0) +
          (response?.usageMetadata?.thoughtsTokenCount ?? 0) +
          (response?.usageMetadata?.toolUsePromptTokenCount ?? 0),
        total_token: response.usageMetadata.totalTokenCount,
        chat_id: chat_id,
      });

      for (const item of createdFiles.map(x => x.id)) {
        await File.update({
          message_id: answerData.id
        }, {where: {id: item}})
      }
    } catch (error) {
      console.log(error);
    }

    try {
      await upsertDailyUserToken({
        aiId: findRealModel?.id,
        userId: chatOne?.user_id,
        response,
      });
    } catch (error) {
      console.log(error);
    }

    const usedTokens = response?.usageMetadata?.totalTokenCount ?? 0;

    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model
    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
    try {
      // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
      await updateTokenAndNotify({
        ctx,
        chatOne,
        findRealModel,
        usedTokens,
        // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
        // transaction: t,       // ถ้ามี transaction อยู่ใน scope
      });

    } catch (error) {
      console.log(error);
    }

    return {
      text: "Gen Doc Success",
    };

    // ถ้าใช้ openai
  } else if (chatOne.ai.model_type === "gpt") {
    // function สำหรับแปลงไฟล์เป็นข้อมูลสำหรับส่งไป model
    async function processFiles(fileArray) {
      const mapped = await Promise.all(
        fileArray.map(async (filename) => {
          const ext = path.extname(filename).toLowerCase();
          const filePath = path.join(__dirname, "../uploads", filename);

          // ---------- รูปภาพ ----------
          if ([".png", ".jpg", ".jpeg"].includes(ext)) {
            const mime =
              ext === ".jpg" ? "image/jpeg" :
              ext === ".jpeg" ? "image/jpeg" :
              ext === ".webp" ? "image/webp" : "image/png";
            const b64 = fs.readFileSync(filePath, { encoding: "base64" });

            return {
              type: "input_image",
              image_url: dataUri(mime, b64),
            };
          }
          // ---------- PDF ----------
          if (ext === ".pdf") {
            const { text, images } = await extractTextFromPDF(filePath);
            const parts = [
              { type: "input_text", text: `นี่คือเนื้อหาจากไฟล์ PDF: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: text || "(ไม่พบข้อความใน PDF)" },
            ];

            // images: [{ data: <base64>, mimeType?: "image/png" }]
            (images || []).forEach((img) => {
              const mime = img?.mimeType || "image/png";
              parts.push({
                type: "input_image",
                image_url: dataUri(mime, img.data),
              });
            });

            return parts;
          }
          // ---------- Word ----------
          if ([".doc", ".docx"].includes(ext)) {
            const { text, images } = await extractTextFromWord(filePath);
            const parts = [
              { type: "input_text", text: `นี่คือเนื้อหาจากไฟล์ Word: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: text || "(ไม่พบข้อความใน Word)" },
            ];

            // images: [{ base64: <string>, contentType?: "image/png" }]
            (images || []).forEach((img) => {
              const mime = img?.contentType || "image/png";
              parts.push({
                type: "input_image",
                image_url: dataUri(mime, img.base64),
              });
            });

            return parts;
          }
          // ---------- Excel ----------
          if ([".xlsx", ".xls"].includes(ext)) {
            const { text, images } = await extractTextFromExcel(filePath);
            const parts = [
              { type: "input_text", text: `นี่คือเนื้อหาจากไฟล์ Excel: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: text || "(ไม่พบข้อความใน Excel)" },
            ];

            // images: [{ base64: <string>, mimeType?: "image/png" }]
            (images || []).forEach((img) => {
              const mime = img?.mimeType || "image/png";
              parts.push({
                type: "input_image",
                image_url: dataUri(mime, img.base64),
              });
            });

            return parts;
          }
          // ---------- PowerPoint ----------
          if ([".pptx", ".ppt"].includes(ext)) {
            const { text, images } = await extractTextFromPowerPoint(filePath);
            const parts = [
              { type: "input_text", text: `นี่คือเนื้อหาจากไฟล์ PowerPoint: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: text || "(ไม่พบข้อความใน PowerPoint)" },
            ];

            // images: [{ base64: <string>, contentType?: "image/png" }]
            (images || []).forEach((img) => {
              const mime = img?.contentType || "image/png";
              parts.push({
                type: "input_image",
                image_url: dataUri(mime, img.base64),
              });
            });

            return parts;
          }
          // ---- MP3 (เสียง) ----
          if (ext === ".mp3") {
            const filePath = path.join(__dirname, "../uploads", filename);
            const transcript = await transcribeAudio(filePath);
            return [
              { type: "input_text", text: `ถอดเสียงจากไฟล์: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: transcript || "(ไม่พบข้อความจากการถอดเสียง)" },
            ];
          } 
          // ---- MP4 (วิดีโอ) ----
          if (ext === ".mp4") {
            const filePath = path.join(__dirname, "../uploads", filename);
            // ส่งเสียงไปถอดเป็นข้อความได้เลย (mp4 รองรับใน Transcriptions)
            const transcript = await transcribeAudio(filePath);
            return [
              { type: "input_text", text: `สรุปจากวิดีโอ: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: transcript || "(ไม่พบข้อความจากการถอดเสียงวิดีโอ)" },
            ];
          } 

          // ไม่รองรับ
          return null;
        })
      );

      // flatten + กรอง null
      return mapped.flat().filter(Boolean);
    }

    // สร้าง array สำหรับเก็บ prompt ที่ผ่านมาโดยมี prompt ตั้งต้น
    // locale: "th" | "en"
    // system prompt ตามภาษา
    const systemText =
      locale === "th"
        ? `คุณคือผู้ช่วยส่วนตัว วันที่และเวลาปัจจุบันของประเทศไทยคือ ${nowTH}`
        : `You are a personal assistant. The current date and time in Thailand is ${nowTH}`;

    // history สำหรับ gpt API
    const historyList = [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: systemText,
          },
        ],
      },
    ];

    // เก็บ prompt ที่ผ่านมาทั้งหมดใน array
    for (const message of messageAllByChatId) {
      const file_history = message?.files.map(x => x?.file_name).filter(Boolean);      
      const fileParts = await processFiles(file_history);

      const isAssistant = message.role === "assistant";
      const history = {
        role: message.role,
        content: [
          {
            type: isAssistant ? "output_text" : "input_text",
            text: message.text,
          },
          // สำหรับส่งไฟล์ไปที่ model
          ...fileParts
        ],
      };
      historyList.push(history);
    }

    // เก็บคำถามล่าสุดที่ถามใน array
    const messagePrompt = {
      role: "user",
      content: [
        { type: "input_text", text: message },
        // สำหรับส่งไฟล์ไปที่ model
      ],
    };

    historyList.push(messagePrompt);
    //console.log(historyList);

    const { files, response } = await openaiGenerateExcel(historyList, {
      model: findRealModel?.model_name,     // เช่น "gpt-5" / "gpt-5-mini" ฯลฯ
      outDir: "./uploads",
      fileBase: `${Date.now()}-gen-doc`,
    });

    console.log(response.usage);
    console.log("saved:", files);

    // อัพเดทเฉพาะ updatedAt ของ chat
    // touch updatedAt อย่างเดียว
    const chatgroupData = await Chatgroup.findByPk(chatOne.chatgroup_id);
    if (chatgroupData) {
      await Chatgroup.update(
        { chatgroup_name: chatgroupData.chatgroup_name },
        { where: { id: chatOne.chatgroup_id } }
      );
    }
    await Chat.update(
      { chat_name: chatOne.chat_name },
      { where: { id: chat_id } }
    );

    // เก็บรูปที่สร้างลงใน db
    const createdFiles = await saveFilesToDb({
      files,                 // array paths จาก generator
      FileModel: File,       // Sequelize model
      uploadUrlPrefix: "/uploads",
      folder: "",
      messageId: null,       // หรือใส่ answerData.id ถ้ารู้แล้ว
    });

    console.log("saved to db:", createdFiles.map(x => x.id));
    // createdFiles คือ array ของ File model ที่คุณสร้างไว้
    const fileIdsNum = createdFiles.map(x => x.id);
    const fileIdsStr = fileIdsNum.map(String);

    // เก็บคำถามลงใน db
    try {
      await Message.create({
        role: "user",
        message_type: message_type,
        text: message,
        file: [],
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
      const answerData = await Message.create({
        role: "assistant",
        message_type: message_type,
        text: "",
        file: fileIdsStr,
        input_token: response.usage.input_tokens,
        output_token: response.usage.output_tokens,
        total_token: response.usage.total_tokens,
        chat_id: chat_id,
      });

      for (const item of createdFiles.map(x => x.id)) {
        await File.update({
          message_id: answerData.id
        }, {where: {id: item}})
      }
    } catch (error) {
      console.log(error);
    }

    try {
      await upsertDailyUserToken({
        aiId: findRealModel?.id,
        userId: chatOne?.user_id,
        response,
      });
    } catch (error) {
      console.log(error);
    }

    const usedTokens = response.usage.total_tokens ?? 0;

    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model
    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
    try {
      // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
      await updateTokenAndNotify({
        ctx,
        chatOne,
        findRealModel,
        usedTokens,
        // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
        // transaction: t,       // ถ้ามี transaction อยู่ใน scope
      });

    } catch (error) {
      console.log(error);
    }

    return {
      text: "Gen Doc Success",
    };
  }
}

exports.updateMessage = async (id, input, ctx) => {
  const { message_type, chat_id, message, fileMessageList, locale } = input;
  console.log(message_type, chat_id, message, fileMessageList, locale);

  // เวลาปัจจุบันของประเทศไทย
  const nowTH = new Date().toLocaleString(
    locale === "th" ? "th-TH" : "en-US",
    {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }
  );

  // เรียกดูข้อมูลของ chat เพื่อดูว่าใช้ model อันไหน
  const chatOne = await Chat.findByPk(chat_id, {
    include: [
      {
        model: Ai,
        as: "ai", // ต้องตรงกับ alias ใน association
      },
      {
        model: User,
        as: "user", // ต้องตรงกับ alias ใน association
        include: [
          {
            model: User_ai,
            as: "user_ai", // ต้องตรงกับ alias ใน association
            required: false,
          },
        ],
      },
    ],
  });
  
  // หา model ที่ต้องใช้จริงของ message นี้
  const findRealModel = await Ai.findOne({
    where: {
      model_type: chatOne.ai.model_type,
      message_type: "TEXT"
    }
  })
  console.log("findRealModel", findRealModel);

  // ห้ามส่งคำถามถ้าเหลือ token ของ user ทั้งหมดเหลือไม่ถึง 15%
  await checkTokenQuota({
    aiId: findRealModel?.id,
    userId: chatOne?.user_id,
    // minPercent: 15, // ไม่ส่งก็ได้ ใช้ค่า default
    ctx
  });

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
            const imgBase64 = fs.readFileSync(filePath, { encoding: "base64" });

            return {
              inlineData: {
                data: imgBase64,
                mimeType: `image/${tranext}`,
              },
            };

            // // เเปลงเป็น base64
            // const imgBase64 = await uploadAndWait(filePath, `image/${tranext}`, filename);

            // return {
            //   fileData: {
            //     fileUri: imgBase64.uri,
            //     mimeType: imgBase64.mimeType,
            //   },
            // };
            
            // ถ้าไฟล์เป็น pdf
          } else if (ext === ".pdf") {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ pdf ให้เป็น text + images
            const { text, images } = await extractTextFromPDF(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const pdfParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ PDF: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก PDF
            ];
            
            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.data,                       // base64 string
                mimeType: img.mimeType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...pdfParts, ...imageParts];

            // // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            // const filePath = path.join(__dirname, "../uploads", filename);
            // console.log(filePath);

            // // แปลงไฟล์ pdf ให้เป็น text
            // const pdfText = await uploadAndWait(filePath, "application/pdf", filename);
            // //console.log(pdfText);

            // return {
            //   fileData: {
            //     fileUri: pdfText.uri,
            //     mimeType: pdfText.mimeType,
            //   },
            // };

          // ถ้าไฟล์เป็น word
          } else if ([".doc", ".docx"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ word ให้เป็น text + images
            const { text, images } = await extractTextFromWord(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const wordParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ Word: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก Word
            ];
            
            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.base64,                       // base64 string
                mimeType: img.contentType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...wordParts, ...imageParts];

          // ถ้าไฟล์เป็น excel
          } else if ([".xlsx", ".xls"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ excel ให้เป็น text + images
            const { text, images } = await extractTextFromExcel(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const excelParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ Excel: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก Excel
            ];

            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.base64,                       // base64 string
                mimeType: img.mimeType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...excelParts, ...imageParts];

          } else if ([".pptx", ".ppt"].includes(ext)) {
            // ดึงไฟล์มาจากที่อยู่ในเครื่อง
            const filePath = path.join(__dirname, "../uploads", filename);
            // แปลงไฟล์ powerpoint ให้เป็น text + images
            const { text, images } = await extractTextFromPowerPoint(filePath);

            // แปลงเป็น parts ที่ใช้กับ Gemini ได้เลย
            const powerPointParts = [
              { text: `นี่คือเนื้อหาจากไฟล์ power point: ${removeFirstPrefix(filename)}` },
              { text }, // เนื้อหาทั้งหมดจาก PowerPoint
            ];
            
            const imageParts = (images || []).map((img, index) => ({
              inlineData: {
                data: img.base64,                       // base64 string
                mimeType: img.contentType || "image/png",
              },
            }));

            // ให้ฟังก์ชันนี้ return เป็น parts array สำหรับ Gemini
            return [...powerPointParts, ...imageParts];

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
      return mapped
      .flatMap((x) => (Array.isArray(x) ? x : [x]))
      .filter((x) => x != null);
    }

    // สร้าง array สำหรับเก็บ prompt ที่ผ่านมาโดยมี prompt ตั้งต้น
    // locale: "th" | "en"
    // ข้อความตามภาษา
    const systemPrompt =
      locale === "th"
        ? `คุณคือผู้ช่วยส่วนตัว วันที่และเวลาปัจจุบันของประเทศไทยคือ ${nowTH}`
        : `You are a personal assistant. The current date and time in Thailand is ${nowTH}`;

    const modelReply =
      locale === "th"
        ? "รับทราบครับ ผมจะทำหน้าที่เป็นผู้ช่วยของคุณ"
        : "Acknowledged. I will act as your personal assistant.";

    // history สำหรับส่งเข้า gemini
    const historyList = [
      {
        role: "user",
        parts: [{ text: systemPrompt }],
      },
      {
        role: "model",
        parts: [{ text: modelReply }],
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

    // ✅ รวมไฟล์จาก history + ล่าสุด แล้วตัดสินใจเปิด/ปิด googleSearch
    const historyFileNames = (messageAllByChatId || [])
      .flatMap(m => (m.files || []).map(f => f.file_name).filter(Boolean));

    const enableGoogleSearch = !hasSearchBlockingFiles([
      ...historyFileNames,
      ...fileMessageList_name,
    ]);

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { text, response } = await geminiChat(
      messageList,
      historyList,
      findRealModel?.model_name,
      { enableGoogleSearch } // ✅ ถ้ามี pdf/doc/xls/ppt/mp4 ใน history/ล่าสุด => ปิด googleSearch
    );
    console.log("text", text);
    console.log("response", response);

    // อัพเดทเฉพาะ updatedAt ของ chat
    // touch updatedAt อย่างเดียว
    const chatgroupData = await Chatgroup.findByPk(chatOne.chatgroup_id);
    if (chatgroupData) {
      await Chatgroup.update(
        { chatgroup_name: chatgroupData.chatgroup_name },
        { where: { id: chatOne.chatgroup_id } }
      );
    }
    await Chat.update(
      { chat_name: chatOne.chat_name },
      { where: { id: chat_id } }
    );

    // เก็บคำถามลงใน db
    try {
      const sendData = await Message.create({
        role: "user",
        message_type: message_type,
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
        message_type: message_type,
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

    try {
      await upsertDailyUserToken({
        aiId: findRealModel?.id,
        userId: chatOne?.user_id,
        response,
      });
    } catch (error) {
      console.log(error);
    }

    const usedTokens = response?.usageMetadata?.totalTokenCount ?? 0;

    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model
    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
    try {
      // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
      await updateTokenAndNotify({
        ctx,
        chatOne,
        findRealModel,
        usedTokens,
        // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
        // transaction: t,       // ถ้ามี transaction อยู่ใน scope
      });

    } catch (error) {
      console.log(error);
    }

    return {
      text: text,
    };

    // ถ้าใช้ openai
  } else if (chatOne.ai.model_type === "gpt") {
    // function สำหรับแปลงไฟล์เป็นข้อมูลสำหรับส่งไป model
    async function processFiles(fileArray) {
      const mapped = await Promise.all(
        fileArray.map(async (filename) => {
          const ext = path.extname(filename).toLowerCase();
          const filePath = path.join(__dirname, "../uploads", filename);

          // ---------- รูปภาพ ----------
          if ([".png", ".jpg", ".jpeg"].includes(ext)) {
            const mime =
              ext === ".jpg" ? "image/jpeg" :
              ext === ".jpeg" ? "image/jpeg" :
              ext === ".webp" ? "image/webp" : "image/png";
            const b64 = fs.readFileSync(filePath, { encoding: "base64" });

            return {
              type: "input_image",
              image_url: dataUri(mime, b64),
            };
          }
          // ---------- PDF ----------
          if (ext === ".pdf") {
            const { text, images } = await extractTextFromPDF(filePath);
            const parts = [
              { type: "input_text", text: `นี่คือเนื้อหาจากไฟล์ PDF: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: text || "(ไม่พบข้อความใน PDF)" },
            ];

            // images: [{ data: <base64>, mimeType?: "image/png" }]
            (images || []).forEach((img) => {
              const mime = img?.mimeType || "image/png";
              parts.push({
                type: "input_image",
                image_url: dataUri(mime, img.data),
              });
            });

            return parts;
          }
          // ---------- Word ----------
          if ([".doc", ".docx"].includes(ext)) {
            const { text, images } = await extractTextFromWord(filePath);
            const parts = [
              { type: "input_text", text: `นี่คือเนื้อหาจากไฟล์ Word: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: text || "(ไม่พบข้อความใน Word)" },
            ];

            // images: [{ base64: <string>, contentType?: "image/png" }]
            (images || []).forEach((img) => {
              const mime = img?.contentType || "image/png";
              parts.push({
                type: "input_image",
                image_url: dataUri(mime, img.base64),
              });
            });

            return parts;
          }
          // ---------- Excel ----------
          if ([".xlsx", ".xls"].includes(ext)) {
            const { text, images } = await extractTextFromExcel(filePath);
            const parts = [
              { type: "input_text", text: `นี่คือเนื้อหาจากไฟล์ Excel: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: text || "(ไม่พบข้อความใน Excel)" },
            ];

            // images: [{ base64: <string>, mimeType?: "image/png" }]
            (images || []).forEach((img) => {
              const mime = img?.mimeType || "image/png";
              parts.push({
                type: "input_image",
                image_url: dataUri(mime, img.base64),
              });
            });

            return parts;
          }
          // ---------- PowerPoint ----------
          if ([".pptx", ".ppt"].includes(ext)) {
            const { text, images } = await extractTextFromPowerPoint(filePath);
            const parts = [
              { type: "input_text", text: `นี่คือเนื้อหาจากไฟล์ PowerPoint: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: text || "(ไม่พบข้อความใน PowerPoint)" },
            ];

            // images: [{ base64: <string>, contentType?: "image/png" }]
            (images || []).forEach((img) => {
              const mime = img?.contentType || "image/png";
              parts.push({
                type: "input_image",
                image_url: dataUri(mime, img.base64),
              });
            });

            return parts;
          }
          // ---- MP3 (เสียง) ----
          if (ext === ".mp3") {
            const filePath = path.join(__dirname, "../uploads", filename);
            const transcript = await transcribeAudio(filePath);
            return [
              { type: "input_text", text: `ถอดเสียงจากไฟล์: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: transcript || "(ไม่พบข้อความจากการถอดเสียง)" },
            ];
          } 
          // ---- MP4 (วิดีโอ) ----
          if (ext === ".mp4") {
            const filePath = path.join(__dirname, "../uploads", filename);
            // ส่งเสียงไปถอดเป็นข้อความได้เลย (mp4 รองรับใน Transcriptions)
            const transcript = await transcribeAudio(filePath);
            return [
              { type: "input_text", text: `สรุปจากวิดีโอ: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: transcript || "(ไม่พบข้อความจากการถอดเสียงวิดีโอ)" },
            ];
          } 

          // ไม่รองรับ
          return null;
        })
      );

      // flatten + กรอง null
      return mapped.flat().filter(Boolean);
    }

    // สร้าง array สำหรับเก็บ prompt ที่ผ่านมาโดยมี prompt ตั้งต้น
    // locale: "th" | "en"
    // system prompt ตามภาษา
    const systemText =
      locale === "th"
        ? `คุณคือผู้ช่วยส่วนตัว วันที่และเวลาปัจจุบันของประเทศไทยคือ ${nowTH}`
        : `You are a personal assistant. The current date and time in Thailand is ${nowTH}`;

    // history สำหรับ gpt API
    const historyList = [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: systemText,
          },
        ],
      },
    ];
    
    // เก็บ prompt ที่ผ่านมาทั้งหมดใน array
    for (const message of messageAllByChatId) {
      const file_history = message?.files.map(x => x?.file_name).filter(Boolean);      
      const fileParts = await processFiles(file_history);

      const isAssistant = message.role === "assistant";
      const history = {
        role: message.role,
        content: [
          {
            type: isAssistant ? "output_text" : "input_text",
            text: message.text,
          },
          // สำหรับส่งไฟล์ไปที่ model
          ...fileParts
        ],
      };
      historyList.push(history);
    }

    // เก็บคำถามล่าสุดที่ถามใน array
    const filteredFiles = await processFiles(fileMessageList_name);
    const messagePrompt = {
      role: "user",
      content: [
        { type: "input_text", text: message },
        // สำหรับส่งไฟล์ไปที่ model
        ...filteredFiles
      ],
    };

    historyList.push(messagePrompt);
    //console.log(historyList);

    // รวมชื่อไฟล์จาก history (ที่ดึงมาจาก DB) + ไฟล์ล่าสุดที่ผู้ใช้แนบมา
    const historyFileNames = (messageAllByChatId || [])
      .flatMap(m => (m.files || []).map(f => f.file_name).filter(Boolean));

    const allFileNamesForSearch = [
      ...historyFileNames,
      ...fileMessageList_name,
    ];

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { text, response, enableSearch } = await openAiChat(
      historyList,
      findRealModel?.model_name,
      { fileNames: allFileNamesForSearch }   // ✅ สำคัญ
    );
    console.log("text", text);
    console.log("response", response);

    // อัพเดทเฉพาะ updatedAt ของ chat
    // touch updatedAt อย่างเดียว
    const chatgroupData = await Chatgroup.findByPk(chatOne.chatgroup_id);
    if (chatgroupData) {
      await Chatgroup.update(
        { chatgroup_name: chatgroupData.chatgroup_name },
        { where: { id: chatOne.chatgroup_id } }
      );
    }
    await Chat.update(
      { chat_name: chatOne.chat_name },
      { where: { id: chat_id } }
    );

    // เก็บคำถามลงใน db
    try {
      const sendData = await Message.create({
        role: "user",
        message_type: message_type,
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
        role: "assistant",
        message_type: message_type,
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

    try {
      await upsertDailyUserToken({
        aiId: findRealModel?.id,
        userId: chatOne?.user_id,
        response,
      });
    } catch (error) {
      console.log(error);
    }

    const usedTokens = response.usage.total_tokens ?? 0;

    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model
    // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
    try {
      // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
      await updateTokenAndNotify({
        ctx,
        chatOne,
        findRealModel,
        usedTokens,
        // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
        // transaction: t,       // ถ้ามี transaction อยู่ใน scope
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
