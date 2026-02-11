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
const { deleteMultipleFiles, deleteUploadFile } = require("../utils/fileUtils");
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

// helper: ถอดเสียงจาก .webm -> string
async function transcribeWebmToTextGemini(filename, locale, model_name) {
  const filePathOld = path.join(__dirname, "../uploads", filename);

  // webm -> mp3
  const { fileName, filePath } = await convertWebmToMp3(filename, filePathOld);

  // upload mp3 เข้า Gemini file manager
  const uploaded = await uploadAndWait(filePath, "audio/mp3", fileName);

  // ✅ history เฉพาะงานถอดเสียง (ไม่ยุ่งกับ history หลัก)
  const transcribeHistory = [
    {
      role: "user",
      parts: [{
        text: locale === "th"
          ? "คุณคือระบบถอดเสียง (transcription engine) ตอบกลับเป็นข้อความที่ถอดเสียงเท่านั้น ห้ามสรุป ห้ามแปล ห้ามเติมคำ"
          : "You are a transcription engine. Reply with transcription text only. No summary, no translation, no extra words."
      }],
    },
    {
      role: "model",
      parts: [{
        text: locale === "th"
          ? "รับทราบ จะส่งเฉพาะข้อความถอดเสียงเท่านั้น"
          : "Acknowledged. I will return transcription text only."
      }],
    },
  ];

  const messageList = [
    {
      text: locale === "th"
        ? "ถอดเสียงไฟล์นี้เป็นข้อความให้ถูกต้อง ส่งมาแค่ข้อความเท่านั้น"
        : "Please transcribe this audio accurately. Return only the transcription."
    },
    { fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType } },
  ];

  const { text, response } = await geminiChat(
    messageList,
    transcribeHistory,
    model_name,
    { enableGoogleSearch: false } // ไม่ต้อง search
  );

  // cleanup ไฟล์ mp3 ชั่วคราว
  await deleteUploadFile(fileName);
  await File.destroy({ where: { file_name: fileName } });

  return { text: String(text || "").trim(), response };
}
function addUsageGemini(a = {}, b = {}) {
  return {
    promptTokenCount: (a.promptTokenCount || 0) + (b.promptTokenCount || 0),
    candidatesTokenCount: (a.candidatesTokenCount || 0) + (b.candidatesTokenCount || 0),
    thoughtsTokenCount: (a.thoughtsTokenCount || 0) + (b.thoughtsTokenCount || 0),
    toolUsePromptTokenCount: (a.toolUsePromptTokenCount || 0) + (b.toolUsePromptTokenCount || 0),
    totalTokenCount: (a.totalTokenCount || 0) + (b.totalTokenCount || 0),
  };
}
function ensureImagePrefixGemini(text, locale) {
  const t = String(text || "").trim();

  const prefix = locale === "th" ? "รูปภาพ" : "image";

  // ถ้าว่าง ก็ให้เป็น prefix เปล่า ๆ (กันพัง)
  if (!t) return prefix.trim();

  // ถ้าขึ้นต้นด้วย รูปภาพ / image อยู่แล้ว (มีหรือไม่มี : - —) ให้ normalize เป็นรูปแบบเดียว
  const re = /^(รูปภาพ|image)\s*[:\-–—]?\s*/i;
  if (re.test(t)) return t.replace(re, prefix);

  // ไม่มีก็เติม
  return prefix + t;
}
function ensureVideoPrefixGemini(text, locale) {
  const t = String(text || "").trim();

  const prefix = locale === "th" ? "วิดีโอ" : "video";

  // ถ้าว่าง ก็ให้เป็น prefix เปล่า ๆ (กันพัง)
  if (!t) return prefix.trim();

  // ถ้าขึ้นต้นด้วย วิดีโอ / video อยู่แล้ว (มีหรือไม่มี : - —) ให้ normalize เป็นรูปแบบเดียว
  const re = /^(วิดีโอ|video)\s*[:\-–—]?\s*/i;
  if (re.test(t)) return t.replace(re, prefix);

  // ไม่มีก็เติม
  return prefix + t;
}

async function transcribeWebmToTextGpt(filename) {
  const filePathOld = path.join(__dirname, "../uploads", filename);

  // webm -> mp3
  const { fileName, filePath } = await convertWebmToMp3(filename, filePathOld);

  // transcribe ด้วย OpenAI (ฟังก์ชันคุณปรับให้คืน {text, usage} แล้ว)
  const { text, usage } = await transcribeAudio(filePath);
  console.log("text convert", text);
  console.log("usage convert", usage);

  // cleanup mp3 ชั่วคราว (กันพังด้วย try)
  try { await deleteUploadFile(fileName); } catch (e) {}
  try { await File.destroy({ where: { file_name: fileName } }); } catch (e) {}

  return { text: String(text || "").trim(), usage: usage || {} };
}
function addUsageOpenAI(a = {}, b = {}) {
  return {
    input_tokens:  (a.input_tokens  || 0) + (b.input_tokens  || 0),
    output_tokens: (a.output_tokens || 0) + (b.output_tokens || 0),
    total_tokens:  (a.total_tokens  || 0) + (b.total_tokens  || 0),
  };
}
function toUsageMetadataFromOpenAIUsage(u = {}) {
  const inTok  = Number(u?.input_tokens || 0);
  const outTok = Number(u?.output_tokens || 0);
  const totTok = Number(u?.total_tokens || (inTok + outTok));
  return {
    promptTokenCount: inTok,
    candidatesTokenCount: outTok,
    totalTokenCount: totTok,
  };
}
function addUsageMetadata(a = {}, b = {}) {
  const ap = Number(a?.promptTokenCount || 0);
  const ac = Number(a?.candidatesTokenCount || 0);
  const at = Number(a?.totalTokenCount || (ap + ac));

  const bp = Number(b?.promptTokenCount || 0);
  const bc = Number(b?.candidatesTokenCount || 0);
  const bt = Number(b?.totalTokenCount || (bp + bc));

  return {
    promptTokenCount: ap + bp,
    candidatesTokenCount: ac + bc,
    totalTokenCount: at + bt,
  };
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
  const fileMessageList_id = list
    .filter((x) => path.extname(x?.filename || "").toLowerCase() !== ".webm")
    .map(x => x?.id)
    .filter(v => v != null);

  // ดึงข้อมูลของ chat ทั้งหมดที่อยู่ใน chatgroup นี้
  const messageAllByChatId = await Message.findAll({
    order: [["id", "ASC"]],
    where: { chat_id: chat_id },
    include: [
      {
        model: File,                // ต้องมี association: Chatgroup.hasMany(Chat, { as: 'chat', foreignKey: 'chatgroup_id' })
        as: 'files',
        attributes: ["file_name"],
        required: false, // บังคับว่าต้องแมตช์ role ด้วย
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
      const file_history = (message?.files || [])
        .map(x => x?.file_name)
        .filter(Boolean);

      const fileParts = await processFiles(file_history);

      const textTag = String(message?.message_type || "").trim().toUpperCase();

      const isTagWithFiles =
        ["IMAGE", "DOC", "VIDEO"].includes(textTag) && fileParts.length > 0;

      const role = isTagWithFiles ? "user" : message.role;

      const history = {
        role,
        parts: [
          { text: isTagWithFiles ? "" : (message.text || "") },
          ...fileParts,
        ],
      };
      historyList.push(history);
    }
    console.log(historyList);

    // เก็บคำถามล่าสุดที่ถามใน array
    // ✅ แยกไฟล์ webm ออกมาก่อน
    const webmFiles = fileMessageList_name.filter(
      (fn) => path.extname(fn || "").toLowerCase() === ".webm"
    );

    // ✅ สะสม token ของการถอดเสียง webm
    let webmUsageTotal = {
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      thoughtsTokenCount: 0,
      toolUsePromptTokenCount: 0,
      totalTokenCount: 0,
    };

    // ✅ ถอดเสียง webm ทั้งหมด (ถ้ามีหลายไฟล์ก็รวมกัน)
    let webmText = "";
    if (webmFiles.length > 0) {
      const texts = [];
      for (const fn of webmFiles) {
        const { text: t, response: trResp } = await transcribeWebmToTextGemini(fn, locale, findRealModel?.model_name);

        if (t) texts.push(t);

        // ✅ รวม token ของรอบถอดเสียง
        webmUsageTotal = addUsageGemini(webmUsageTotal, trResp?.usageMetadata || {});
      }
      webmText = texts.join("\n");
    }

    // ✅ ข้อความจริงที่จะใช้ทั้ง “ส่งให้โมเดล” และ “เก็บลง DB”
    // ✅ ถ้ามี text จาก webm -> ใช้ webmText อย่างเดียว (ไม่ใช้ message)
    const effectiveMessage = (webmText && webmText.trim().length > 0)
      ? webmText.trim()
      : String(message || "").trim();

    // ✅ ส่งเข้า processFiles เฉพาะไฟล์ที่ไม่ใช่ webm (กันข้อความซ้ำ)
    const nonWebmFiles = fileMessageList_name.filter(
      (fn) => path.extname(fn || "").toLowerCase() !== ".webm"
    );

    const filteredFiles = await processFiles(nonWebmFiles);

    const messageList = [
      { text: effectiveMessage },
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

    console.log("messageList", messageList);
    console.log("historyList", historyList);

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { text, response } = await geminiChat(
      messageList,
      historyList,
      findRealModel?.model_name,
      { enableGoogleSearch } // ✅ ถ้ามี pdf/doc/xls/ppt/mp4 ใน history/ล่าสุด => ปิด googleSearch
    );
    console.log("text", text);
    console.log("response", response);

    // ✅ แยก response งานถอดเสียง
    const responseTranscribe = {
      usageMetadata: webmUsageTotal,
    };
    console.log("responseTranscribe", responseTranscribe);

    // ✅ รวม token ของ "ถอดเสียง webm" เข้ากับ token ของ "คำตอบหลัก"
    const mergedUsage = addUsageGemini(response?.usageMetadata || {}, webmUsageTotal);

    // ✅ สร้าง responseMerged เพื่อใช้ต่อทั้งบันทึก DB + quota
    const responseMerged = { ...response, usageMetadata: mergedUsage };

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
        text: effectiveMessage, // ✅ ใช้ข้อความจาก webm (รวมกับ message ถ้ามี)
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
        input_token: responseMerged.usageMetadata.promptTokenCount,
        output_token:
          (responseMerged?.usageMetadata?.candidatesTokenCount ?? 0) +
          (responseMerged?.usageMetadata?.thoughtsTokenCount ?? 0) +
          (responseMerged?.usageMetadata?.toolUsePromptTokenCount ?? 0),
        total_token: responseMerged.usageMetadata.totalTokenCount,
        chat_id: chat_id,
      });
    } catch (error) {
      console.log(error);
    }

    // บันทึกของ responseTranscribe เปลี่ยนด้วยเสียง
    if (responseTranscribe?.usageMetadata?.totalTokenCount !== 0) {
      try {
        await upsertDailyUserToken({
          aiId: findRealModel?.id,
          userId: chatOne?.user_id,
          response: responseTranscribe,
        });
      } catch (error) {
        console.log(error);
      }
      const usedTranTokens = responseTranscribe?.usageMetadata?.totalTokenCount ?? 0;
      // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
      try {
        // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
        await updateTokenAndNotify({
          ctx,
          chatOne,
          findRealModel,
          usedTokens: usedTranTokens,
          // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
          // transaction: t,       // ถ้ามี transaction อยู่ใน scope
        });

      } catch (error) {
        console.log(error);
      }
    }
    
    // บันทึกของ response หลัก
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
    // เลือกไฟล์ที่จะทำ RAG
    const RAG_EXTS = new Set([".xls", ".xlsx"]);
    function isRagFile(filename) {
      const ext = path.extname(filename || "").toLowerCase();
      return RAG_EXTS.has(ext);
    }
    function splitFilesForRag(fileArray = []) {
      const ragFiles = [];
      const directFiles = [];
      for (const fn of fileArray) {
        if (!fn) continue;
        if (isRagFile(fn)) ragFiles.push(fn);
        else directFiles.push(fn);
      }
      return { ragFiles, directFiles };
    }

    // ✅ สะสม token จากการถอดเสียงใน processFiles (mp3/mp4/webm ใน history เป็นต้น)
    let mediaUsageTotal = { 
      input_tokens: 0, 
      output_tokens: 0, 
      total_tokens: 0 
    };

    // ✅ processFiles: ส่งไฟล์ "ที่ไม่ใช่ PDF/Excel" เข้า model แบบ inline
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
            (images || []).forEach((img) => {
              const mime = img?.contentType || "image/png";
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
            const { text: transcript, usage } = await transcribeAudio(filePath);
            console.log("transcript", transcript);
            console.log("usage", usage);

            // ✅ รวม token จากการถอดเสียง mp3
            mediaUsageTotal = addUsageOpenAI(mediaUsageTotal, usage || {});

            return [
              { type: "input_text", text: `ถอดเสียงจากไฟล์: ${removeFirstPrefix(filename)}` },
              { type: "input_text", text: transcript || "(ไม่พบข้อความจากการถอดเสียง)" },
            ];
          }
          // ---- MP4 (วิดีโอ) ----
          if (ext === ".mp4") {
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

    // ✅ สร้าง history: ไฟล์ non-rag ส่งเข้า prompt / ไฟล์ rag ใส่แค่ placeholder (ไม่ส่งเนื้อหา)
    for (const messageRow of messageAllByChatId) {
      const file_history = (messageRow?.files || [])
        .map((x) => x?.file_name)
        .filter(Boolean);

      const { ragFiles: ragHistoryFiles, directFiles: directHistoryFiles } =
        splitFilesForRag(file_history);

      const directParts = await processFiles(directHistoryFiles);

      const tag = String(messageRow?.message_type || "").trim().toUpperCase();

      // ✅ ถ้ามีไฟล์ (ไม่ว่าจะ rag/direct) และ tag เป็น IMAGE/DOC/VIDEO -> บังคับ role เป็น user
      const hasAnyFiles = (ragHistoryFiles.length + directHistoryFiles.length) > 0;
      const isTagWithFiles = ["IMAGE", "DOC", "VIDEO"].includes(tag) && hasAnyFiles;

      const role = isTagWithFiles ? "user" : messageRow.role;
      const isAssistant = role === "assistant";

      // ไม่ส่งคำว่า IMAGE/DOC/VIDEO เข้า prompt
      let textPart = isTagWithFiles ? "" : (messageRow.text || "");

      // ✅ กัน history ว่าง: ถ้ามีแต่ ragFiles และไม่มีข้อความ ให้ใส่ placeholder รายชื่อไฟล์
      if (!textPart && ragHistoryFiles.length > 0) {
        textPart =
          locale === "th"
            ? `แนบไฟล์สำหรับค้นหา (RAG): ${ragHistoryFiles.map(removeFirstPrefix).join(", ")}`
            : `Attached files for RAG search: ${ragHistoryFiles.map(removeFirstPrefix).join(", ")}`;
      }

      historyList.push({
        role,
        content: [
          {
            type: isAssistant ? "output_text" : "input_text",
            text: textPart,
          },
          ...directParts,
        ],
      });
    }
    console.log(historyList);

    // ✅ แยกไฟล์ webm (เฉพาะไฟล์ล่าสุดที่แนบมา)
    const webmFiles = fileMessageList_name.filter(
      (fn) => path.extname(fn || "").toLowerCase() === ".webm"
    );

    // ✅ สะสม usage ของการถอดเสียง webm
    let webmUsageTotal = { 
      input_tokens: 0, 
      output_tokens: 0, 
      total_tokens: 0 
    };

    let webmText = "";
    if (webmFiles.length > 0) {
      const texts = [];
      for (const fn of webmFiles) {
        const { text: t, usage } = await transcribeWebmToTextGpt(fn);

        if (t) texts.push(t);

        webmUsageTotal = addUsageOpenAI(webmUsageTotal, usage || {});
      }
      webmText = texts.join("\n");
    }

    // ✅ ถ้ามี text จาก webm -> ใช้ webmText อย่างเดียว (ไม่ใช้ message)
    const effectiveMessage = (webmText && webmText.trim().length > 0)
      ? webmText.trim()
      : String(message || "").trim();

    // รวมชื่อไฟล์จาก history + ไฟล์ล่าสุดที่ผู้ใช้แนบมา (ใช้ให้ openAiChat รู้ว่ามีไฟล์อะไรบ้าง)
    const historyFileNames = (messageAllByChatId || [])
      .flatMap((m) => (m.files || []).map((f) => f.file_name).filter(Boolean));

    const allFileNamesForSearch = [
      ...historyFileNames,
      ...fileMessageList_name,
    ];

    // ✅ เตรียมไฟล์ทั้งหมดสำหรับ mapping -> fileRows
    const allFileNames = [...new Set([...historyFileNames, ...fileMessageList_name])];

    // 2) map file_name -> File row (id) เพื่อ index ได้
    const fileRows = await File.findAll({
      where: { file_name: { [Op.in]: allFileNames } },
      attributes: ["id", "file_name"],
      raw: true,
    });

    // ✅ RAG เฉพาะ PDF/Excel
    const ragFileRows = (fileRows || []).filter((r) => isRagFile(r.file_name));
    const fileIdsInChatForRag = ragFileRows.map((x) => x.id);

    // ✅ index เฉพาะ PDF/Excel
    if (ragFileRows.length > 0) {
      await ensureIndexedFilesForChat({
        db,
        chatId: chat_id,
        files: ragFileRows,
        extractors: {
          extractTextFromPDF,     // ใช้ PDF
          extractTextFromExcel,   // ใช้ Excel
        },
        transcribeAudio, // จะไม่ถูกใช้ใน ensureIndexedFilesForChat ถ้าไม่มี audio
      });
    }

    // ✅ retrieve context เฉพาะ PDF/Excel
    let contextText = "";
    if (fileIdsInChatForRag.length > 0) {
      const ret = await retrieveContext({
        db,
        chatId: chat_id,
        fileIds: fileIdsInChatForRag,
        query: effectiveMessage,
        topK: 60,
      });
      contextText = ret?.contextText || "";
    }

    // 5) สร้าง context part (ถ้าเจอ)
    const ragPart = contextText
      ? { type: "input_text", text: `CONTEXT (from uploaded files):\n${contextText}` }
      : null;

    // ✅ ไฟล์ล่าสุด: ส่งเข้า prompt เฉพาะ non-rag
    const { ragFiles: ragLatestFiles, directFiles: directLatestFiles } =
      splitFilesForRag(fileMessageList_name);

    // ✅ ตัด webm ออกจากไฟล์ที่จะส่งเข้า prompt
    const directLatestNoWebm = directLatestFiles.filter(
      (fn) => path.extname(fn || "").toLowerCase() !== ".webm"
    );

    const filteredFiles = await processFiles(directLatestNoWebm);

    const messagePrompt = {
      role: "user",
      content: [
        ...(ragPart ? [ragPart] : []),

        // (ออปชัน) ใส่ชื่อไฟล์ rag ที่แนบมารอบนี้ เพื่อให้โมเดลรู้ว่ามีไฟล์อะไรที่ถูกใช้ค้นหา
        ...(ragLatestFiles.length > 0
          ? [{
              type: "input_text",
              text:
                locale === "th"
                  ? `แนบไฟล์สำหรับค้นหา (RAG): ${ragLatestFiles.map(removeFirstPrefix).join(", ")}`
                  : `Attached files for RAG search: ${ragLatestFiles.map(removeFirstPrefix).join(", ")}`,
            }]
          : []),

        { type: "input_text", text: effectiveMessage },
        ...filteredFiles,
      ],
    };
    console.log(messagePrompt);

    historyList.push(messagePrompt);
    const out =
      typeof messagePrompt === "string"
        ? messagePrompt
        : JSON.stringify(messagePrompt, null, 2);

    //fs.writeFileSync("messagePrompt.log", out, "utf8");
    //console.log("✅ wrote messagePrompt.log");

    console.log("historyList", historyList);

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { text, response, enableSearch } = await openAiChat(
      historyList,
      findRealModel?.model_name,
      { fileNames: allFileNamesForSearch }   // ✅ สำคัญ
    );
    console.log("text", text);
    console.log("response", response);

    // ✅ รวม token: (webm ที่ถอดนอก processFiles) + (mp3/mp4 ที่ถอดใน processFiles)
    const extraUsageTotal = addUsageOpenAI(webmUsageTotal, mediaUsageTotal);
    const responseMerged = {
      ...response,
      usage: addUsageOpenAI(response?.usage || {}, extraUsageTotal),
    };
    // ✅ กอง B: ถามปกติ + mp3/mp4
    const responseMain = {
      usage: addUsageOpenAI(response?.usage, mediaUsageTotal)
    }
    // ✅ กอง A: webm อย่างเดียว
    const responseWebm = {
      usage: webmUsageTotal
    };

    console.log("responseMerged", responseMerged);
    console.log("responseMain", responseMain);
    console.log("responseWebm", responseWebm);

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
        text: effectiveMessage,
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
        input_token: responseMerged.usage.input_tokens,
        output_token: responseMerged.usage.output_tokens,
        total_token: responseMerged.usage.total_tokens,
        chat_id: chat_id,
      });
    } catch (error) {
      console.log(error);
    }

    // บันทึกของ responseWebm เปลี่ยนด้วยเสียง
    if (responseWebm?.usage.total_tokens !== 0) {
      try {
        await upsertDailyUserToken({
          aiId: findRealModel?.id,
          userId: chatOne?.user_id,
          response: responseWebm,
        });
      } catch (error) {
        console.log(error);
      }
      const usedTranTokens = responseWebm?.usage.total_tokens ?? 0;
      // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
      try {
        // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
        await updateTokenAndNotify({
          ctx,
          chatOne,
          findRealModel,
          usedTokens: usedTranTokens,
          // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
          // transaction: t,       // ถ้ามี transaction อยู่ใน scope
        });

      } catch (error) {
        console.log(error);
      }
    }

    // บันทึกของ response หลัก
    try {
      await upsertDailyUserToken({
        aiId: findRealModel?.id,
        userId: chatOne?.user_id,
        response: responseMain,
      });
    } catch (error) {
      console.log(error);
    }
    const usedTokens = responseMain.usage.total_tokens ?? 0;
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

  // นำชื่อไฟล์ที่อัพโหลดเก็บเข้าไปใน array
  const list = Array.isArray(fileMessageList) ? fileMessageList : [];

  console.log("fileMessageList", fileMessageList);

  const fileMessageList_name = list.map(x => x?.filename).filter(Boolean);
  const fileMessageList_id = list
    .filter((x) => path.extname(x?.filename || "").toLowerCase() !== ".webm")
    .map(x => x?.id)
    .filter(v => v != null);

  // ดึงข้อมูลของ chat ทั้งหมดที่อยู่ใน chatgroup นี้
  const messageAllByChatId = await Message.findAll({
    order: [["id", "ASC"]],
    where: { chat_id: chat_id },
    include: [
      {
        model: File,                // ต้องมี association: Chatgroup.hasMany(Chat, { as: 'chat', foreignKey: 'chatgroup_id' })
        as: 'files',
        attributes: ["file_name"],
        required: false, // บังคับว่าต้องแมตช์ role ด้วย
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
      const file_history = (message?.files || [])
        .map(x => x?.file_name)
        .filter(Boolean);

      const fileParts = []; // <-- แค่นี้พอ (แทน await processFiles(file_history))

      const textTag = String(message?.message_type || "").trim().toUpperCase();

      const isTagWithFiles =
        ["IMAGE", "DOC", "VIDEO"].includes(textTag) && fileParts.length > 0;

      const role = isTagWithFiles ? "user" : message.role;

      const history = {
        role,
        parts: [
          { text: isTagWithFiles ? "" : (message.text || "") },
          ...fileParts,
        ],
      };
      historyList.push(history);
    }
    console.log(historyList);

    // เก็บคำถามล่าสุดที่ถามใน array
    // ✅ แยกไฟล์ webm ออกมาก่อน
    const webmFiles = fileMessageList_name.filter(
      (fn) => path.extname(fn || "").toLowerCase() === ".webm"
    );

    // ✅ สะสม token ของการถอดเสียง webm
    let webmUsageTotal = {
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      thoughtsTokenCount: 0,
      toolUsePromptTokenCount: 0,
      totalTokenCount: 0,
    };

    // ✅ ถอดเสียง webm ทั้งหมด (ถ้ามีหลายไฟล์ก็รวมกัน)
    let webmText = "";
    if (webmFiles.length > 0) {
      const texts = [];
      for (const fn of webmFiles) {
        const { text: t, response: trResp } = await transcribeWebmToTextGemini(fn, locale, chatOne?.ai?.model_name);

        if (t) texts.push(t);

        // ✅ รวม token ของรอบถอดเสียง
        webmUsageTotal = addUsageGemini(webmUsageTotal, trResp?.usageMetadata || {});
      }
      webmText = texts.join("\n");
    }

    // ✅ ข้อความจริงที่จะใช้ทั้ง “ส่งให้โมเดล” และ “เก็บลง DB”
    // ✅ ถ้ามี text จาก webm -> ใช้ webmText อย่างเดียว (ไม่ใช้ message)
    const effectiveMessageRaw = (webmText && webmText.trim().length > 0)
      ? webmText.trim()
      : String(message || "").trim();

    // ✅ บังคับให้คำถามล่าสุดขึ้นต้นด้วย รูปภาพ:/image: เสมอ
    const effectiveMessage = ensureImagePrefixGemini(effectiveMessageRaw, locale);

    // ✅ ส่งเข้า processFiles เฉพาะไฟล์ที่ไม่ใช่ webm (กันข้อความซ้ำ)
    const nonWebmFiles = fileMessageList_name.filter(
      (fn) => path.extname(fn || "").toLowerCase() !== ".webm"
    );

    const filteredFiles = await processFiles(nonWebmFiles);

    const messageList = [
      { text: effectiveMessage },
      ...filteredFiles,
    ];
    console.log(messageList);

    console.log("messageList", messageList);
    console.log("historyList", historyList);

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

    // ✅ แยก response งานถอดเสียง
    const responseTranscribe = {
      usageMetadata: webmUsageTotal,
    };
    console.log("responseTranscribe", responseTranscribe);

    // ✅ รวม token ของ "ถอดเสียง webm" เข้ากับ token ของ "คำตอบหลัก"
    const mergedUsage = addUsageGemini(response?.usageMetadata || {}, webmUsageTotal);

    // ✅ สร้าง responseMerged เพื่อใช้ต่อทั้งบันทึก DB + quota
    const responseMerged = { ...response, usageMetadata: mergedUsage };

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
      const sendData = await Message.create({
        role: "user",
        message_type: message_type,
        text: effectiveMessageRaw,
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
      const answerData = await Message.create({
        role: "model",
        message_type: message_type,
        text: "",
        file: fileIdsStr,
        input_token: responseMerged.usageMetadata.promptTokenCount,
        output_token:
          (responseMerged?.usageMetadata?.candidatesTokenCount ?? 0) +
          (responseMerged?.usageMetadata?.thoughtsTokenCount ?? 0) +
          (responseMerged?.usageMetadata?.toolUsePromptTokenCount ?? 0),
        total_token: responseMerged.usageMetadata.totalTokenCount,
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

    // บันทึกของ responseTranscribe เปลี่ยนด้วยเสียง
    if (responseTranscribe?.usageMetadata?.totalTokenCount !== 0) {
      try {
        await upsertDailyUserToken({
          aiId: chatOne?.ai?.id,
          userId: chatOne?.user_id,
          response: responseTranscribe,
        });
      } catch (error) {
        console.log(error);
      }
      const usedTranTokens = responseTranscribe?.usageMetadata?.totalTokenCount ?? 0;
      // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
      try {
        // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
        await updateTokenAndNotify({
          ctx,
          chatOne,
          findRealModel: chatOne?.ai,
          usedTokens: usedTranTokens,
          // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
          // transaction: t,       // ถ้ามี transaction อยู่ใน scope
        });

      } catch (error) {
        console.log(error);
      }
    }

    // บันทึกของ response หลัก
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
    // เลือกไฟล์ที่จะทำ RAG
    const RAG_EXTS = new Set([".pdf", ".xls", ".xlsx"]);
    function isRagFile(filename) {
      const ext = path.extname(filename || "").toLowerCase();
      return RAG_EXTS.has(ext);
    }
    function splitFilesForRag(fileArray = []) {
      const ragFiles = [];
      const directFiles = [];
      for (const fn of fileArray) {
        if (!fn) continue;
        if (isRagFile(fn)) ragFiles.push(fn);
        else directFiles.push(fn);
      }
      return { ragFiles, directFiles };
    }
    
    // ✅ สะสม token จากการถอดเสียงใน processFiles (mp3/mp4/webm ใน history เป็นต้น)
    let mediaUsageTotal = { 
      input_tokens: 0, 
      output_tokens: 0, 
      total_tokens: 0 
    };

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

    // ✅ สร้าง history: ไฟล์ non-rag ส่งเข้า prompt / ไฟล์ rag ใส่แค่ placeholder (ไม่ส่งเนื้อหา)
    for (const messageRow of messageAllByChatId) {
      const file_history = (messageRow?.files || [])
        .map((x) => x?.file_name)
        .filter(Boolean);

      const { ragFiles: ragHistoryFiles, directFiles: directHistoryFiles } =
        splitFilesForRag(file_history);

      const directParts = []; // ✅ ปิดประมวลผล + ไม่ส่งไฟล์ใน history

      const tag = String(messageRow?.message_type || "").trim().toUpperCase();

      // ✅ ถ้ามีไฟล์ (ไม่ว่าจะ rag/direct) และ tag เป็น IMAGE/DOC/VIDEO -> บังคับ role เป็น user
      const hasAnyFiles = (ragHistoryFiles.length + directHistoryFiles.length) > 0;
      const isTagWithFiles = ["IMAGE", "DOC", "VIDEO"].includes(tag) && hasAnyFiles;

      const role = isTagWithFiles ? "user" : messageRow.role;
      const isAssistant = role === "assistant";

      // ไม่ส่งคำว่า IMAGE/DOC/VIDEO เข้า prompt
      let textPart = isTagWithFiles ? "" : (messageRow.text || "");

      // ✅ กัน history ว่าง: ถ้ามีแต่ ragFiles และไม่มีข้อความ ให้ใส่ placeholder รายชื่อไฟล์
      if (!textPart && ragHistoryFiles.length > 0) {
        textPart =
          locale === "th"
            ? `แนบไฟล์สำหรับค้นหา (RAG): ${ragHistoryFiles.map(removeFirstPrefix).join(", ")}`
            : `Attached files for RAG search: ${ragHistoryFiles.map(removeFirstPrefix).join(", ")}`;
      }

      historyList.push({
        role,
        content: [
          {
            type: isAssistant ? "output_text" : "input_text",
            text: textPart,
          },
          ...directParts,
        ],
      });
    }
    console.log(historyList);

    // ✅ แยกไฟล์ webm (เฉพาะไฟล์ล่าสุดที่แนบมา)
    const webmFiles = fileMessageList_name.filter(
      (fn) => path.extname(fn || "").toLowerCase() === ".webm"
    );

    // ✅ สะสม usage ของการถอดเสียง webm
    let webmUsageTotal = { 
      input_tokens: 0, 
      output_tokens: 0, 
      total_tokens: 0 
    };

    let webmText = "";
    if (webmFiles.length > 0) {
      const texts = [];
      for (const fn of webmFiles) {
        const { text: t, usage } = await transcribeWebmToTextGpt(fn);

        if (t) texts.push(t);

        webmUsageTotal = addUsageOpenAI(webmUsageTotal, usage || {});
      }
      webmText = texts.join("\n");
    }

    // ✅ ถ้ามี text จาก webm -> ใช้ webmText อย่างเดียว (ไม่ใช้ message)
    const effectiveMessage = (webmText && webmText.trim().length > 0)
      ? webmText.trim()
      : String(message || "").trim();

    // เก็บคำถามล่าสุดที่ถามใน array
    const messagePrompt = {
      role: "user",
      content: [
        { type: "input_text", text: effectiveMessage },
        // สำหรับส่งไฟล์ไปที่ model
      ],
    };

    historyList.push(messagePrompt);
    //console.log(messagePrompt);

    console.log("historyList", historyList);

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { files, response } = await openaiGenerateImage(historyList, {
      model: findRealModel?.model_name,
      aspectRatio: "1:1",
      outDir: "./uploads",
      fileBase: `${Date.now()}-gen-image`,
      n: 1,
    });
    console.log(response);
    console.log("saved:", files);

    // ✅ รวม token: (webm ที่ถอดนอก processFiles) + (mp3/mp4 ที่ถอดใน processFiles)
    const extraUsageTotal = addUsageOpenAI(webmUsageTotal, mediaUsageTotal);
    const responseMerged = {
      ...response,
      usage: addUsageOpenAI(response?.usage || {}, extraUsageTotal),
    };
    // ✅ กอง B: ถามปกติ + mp3/mp4
    const responseMain = {
      usage: addUsageOpenAI(response?.usage, mediaUsageTotal)
    }
    // ✅ กอง A: webm อย่างเดียว
    const responseWebm = {
      usage: webmUsageTotal
    };

    console.log("responseMerged", responseMerged);
    console.log("responseMain", responseMain);
    console.log("responseWebm", responseWebm);

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
      const sendData = await Message.create({
        role: "user",
        message_type: message_type,
        text: effectiveMessage,
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
      const answerData = await Message.create({
        role: "assistant",
        message_type: message_type,
        text: "",
        file: fileIdsStr,
        input_token: responseMerged.usage.input_tokens,
        output_token: responseMerged.usage.output_tokens,
        total_token: responseMerged.usage.total_tokens,
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

    // บันทึกของ responseWebm เปลี่ยนด้วยเสียง
    if (responseWebm?.usage.total_tokens !== 0) {
      try {
        await upsertDailyUserToken({
          aiId: chatOne?.ai?.id,
          userId: chatOne?.user_id,
          response: responseWebm,
        });
      } catch (error) {
        console.log(error);
      }
      const usedTranTokens = responseWebm?.usage.total_tokens ?? 0;
      // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
      try {
        // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
        await updateTokenAndNotify({
          ctx,
          chatOne,
          findRealModel: chatOne?.ai,
          usedTokens: usedTranTokens,
          // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
          // transaction: t,       // ถ้ามี transaction อยู่ใน scope
        });

      } catch (error) {
        console.log(error);
      }
    }

    // บันทึกของ response หลัก
    try {
      await upsertDailyUserToken({
        aiId: findRealModel?.id,
        userId: chatOne?.user_id,
        response: responseMain,
      });
    } catch (error) {
      console.log(error);
    }
    const usedTokens = responseMain.usage.total_tokens ?? 0;
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

  // นำชื่อไฟล์ที่อัพโหลดเก็บเข้าไปใน array
  const list = Array.isArray(fileMessageList) ? fileMessageList : [];

  console.log("fileMessageList", fileMessageList);

  const fileMessageList_name = list.map(x => x?.filename).filter(Boolean);
  const fileMessageList_id = list
    .filter((x) => path.extname(x?.filename || "").toLowerCase() !== ".webm")
    .map(x => x?.id)
    .filter(v => v != null);

  // ดึงข้อมูลของ chat ทั้งหมดที่อยู่ใน chatgroup นี้
  const messageAllByChatId = await Message.findAll({
    order: [["id", "ASC"]],
    where: { chat_id: chat_id },
    include: [
      {
        model: File,                // ต้องมี association: Chatgroup.hasMany(Chat, { as: 'chat', foreignKey: 'chatgroup_id' })
        as: 'files',
        attributes: ["file_name"],
        required: false, // บังคับว่าต้องแมตช์ role ด้วย
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
      const file_history = (message?.files || [])
        .map(x => x?.file_name)
        .filter(Boolean);

      const fileParts = []; // <-- แค่นี้พอ (แทน await processFiles(file_history))

      const textTag = String(message?.message_type || "").trim().toUpperCase();

      const isTagWithFiles =
        ["IMAGE", "DOC", "VIDEO"].includes(textTag) && fileParts.length > 0;

      const role = isTagWithFiles ? "user" : message.role;

      const history = {
        role,
        parts: [
          { text: isTagWithFiles ? "" : (message.text || "") },
          ...fileParts,
        ],
      };
      historyList.push(history);
    }
    console.log(historyList);

    // เก็บคำถามล่าสุดที่ถามใน array
    // ✅ แยกไฟล์ webm ออกมาก่อน
    const webmFiles = fileMessageList_name.filter(
      (fn) => path.extname(fn || "").toLowerCase() === ".webm"
    );

    // ✅ สะสม token ของการถอดเสียง webm
    let webmUsageTotal = {
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      thoughtsTokenCount: 0,
      toolUsePromptTokenCount: 0,
      totalTokenCount: 0,
    };

    // ✅ ถอดเสียง webm ทั้งหมด (ถ้ามีหลายไฟล์ก็รวมกัน)
    let webmText = "";
    if (webmFiles.length > 0) {
      const texts = [];
      for (const fn of webmFiles) {
        const { text: t, response: trResp } = await transcribeWebmToTextGemini(fn, locale, chatOne?.ai?.model_name);

        if (t) texts.push(t);

        // ✅ รวม token ของรอบถอดเสียง
        webmUsageTotal = addUsageGemini(webmUsageTotal, trResp?.usageMetadata || {});
      }
      webmText = texts.join("\n");
    }

    // ✅ ข้อความจริงที่จะใช้ทั้ง “ส่งให้โมเดล” และ “เก็บลง DB”
    // ✅ ถ้ามี text จาก webm -> ใช้ webmText อย่างเดียว (ไม่ใช้ message)
    const effectiveMessageRaw = (webmText && webmText.trim().length > 0)
      ? webmText.trim()
      : String(message || "").trim();

    // ✅ บังคับให้คำถามล่าสุดขึ้นต้นด้วย รูปภาพ:/image: เสมอ
    const effectiveMessage = ensureVideoPrefixGemini(effectiveMessageRaw, locale);

    // ✅ ส่งเข้า processFiles เฉพาะไฟล์ที่ไม่ใช่ webm (กันข้อความซ้ำ)
    const nonWebmFiles = fileMessageList_name.filter(
      (fn) => path.extname(fn || "").toLowerCase() !== ".webm"
    );

    const filteredFiles = await processFiles(nonWebmFiles);

    const messageList = [
      { text: effectiveMessage },
      ...filteredFiles,
    ];
    console.log(messageList);

    console.log("messageList", messageList);
    console.log("historyList", historyList);

    const seconds = 8;
    const costPerSecondUsd = 0.15; // veo 3.1 fast
    const spentUsd = seconds * costPerSecondUsd;

    // 1) เรียก generate video
    const {
      files,
      response: videoOperation, // <- operation จาก veo
      tokens: tokenMeta,        // <- { modelUsed, fallbackUsed, promptTokenCount, totalTokens }
      input_token,              // <- prompt tokens
      output_token,             // <- token เทียบเท่าจากเงิน (ถ้าส่ง spentUsd มา) ไม่งั้น 0
      cost_equivalent,
      forcedResolution,
    } = await geminiGenerateVideo(historyList, messageList, {
      model: findRealModel?.model_name,
      outDir: "./uploads",
      fileBase: `${Date.now()}-gen-video`,
      spentUsd,
      // spentUsd: videoCostUsd, // <- ถ้ามีค่าเงินจริง ค่อยส่งมาเพื่อให้ output_token มีค่า
    });

    // 2) ✅ สร้าง responseVideo ให้ “หน้าตาเหมือน” response ของ gemini (เพื่อใช้กับระบบ token เดิม)
    const responseVideo = {
      // เก็บ operation ไว้เผื่อดีบัก/อ้างอิง
      operation: videoOperation,

      // ✅ โครง usageMetadata ให้เข้ากับฟังก์ชันเดิมของคุณ
      usageMetadata: {
        promptTokenCount: Number(input_token || 0),
        candidatesTokenCount: Number(output_token || 0),
        totalTokenCount: Number(input_token || 0) + Number(output_token || 0),
      },

      // เก็บ meta เพิ่มเติมไว้ได้ (ไม่กระทบระบบเดิม)
      tokenMeta,
      cost_equivalent,
      forcedResolution,
    };

    // 3) ✅ (ถ้ามีถอดเสียง) รวม token “ถอดเสียง webm” + “งานวิดีโอ”
    const responseTranscribe = { usageMetadata: webmUsageTotal }; // ของเดิมคุณ
    const mergedUsage = addUsageGemini(
      responseVideo?.usageMetadata || {},
      responseTranscribe?.usageMetadata || {}
    );

    // ✅ responseMerged เอาไปใช้ต่อทั้งบันทึก DB + quota
    const responseMerged = { ...responseVideo, usageMetadata: mergedUsage };

    console.log("responseVideo", responseVideo);
    console.log("responseTranscribe", responseTranscribe);
    console.log("responseMerged", responseMerged);

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
      const sendData = await Message.create({
        role: "user",
        message_type: message_type,
        text: effectiveMessageRaw,
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

    const inTok  = responseMerged?.usageMetadata?.promptTokenCount ?? 0;
    const outTok = responseMerged?.usageMetadata?.candidatesTokenCount ?? 0;
    const totTok = responseMerged?.usageMetadata?.totalTokenCount ?? 0;

    // เก็บคำตอบจาก model ลงใน db
    try {
      const answerData = await Message.create({
        role: "model",
        message_type: message_type,
        text: "",
        file: fileIdsStr,
        input_token: inTok,
        output_token: outTok,
        total_token: totTok,
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

    // บันทึกของ responseTranscribe เปลี่ยนด้วยเสียง
    if (responseTranscribe?.usageMetadata?.totalTokenCount !== 0) {
      try {
        await upsertDailyUserToken({
          aiId: chatOne?.ai?.id,
          userId: chatOne?.user_id,
          response: responseTranscribe,
        });
      } catch (error) {
        console.log(error);
      }
      const usedTranTokens = responseTranscribe?.usageMetadata?.totalTokenCount ?? 0;
      // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
      try {
        // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
        await updateTokenAndNotify({
          ctx,
          chatOne,
          findRealModel: chatOne?.ai,
          usedTokens: usedTranTokens,
          // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
          // transaction: t,       // ถ้ามี transaction อยู่ใน scope
        });

      } catch (error) {
        console.log(error);
      }
    }

    // บันทึกของ response หลัก
    try {
      await upsertDailyUserToken({
        aiId: findRealModel?.id,
        userId: chatOne?.user_id,
        response: responseVideo,
      });
    } catch (error) {
      console.log(error);
    }
    const usedTokens = responseVideo?.usageMetadata?.totalTokenCount ?? 0;
    //const usedTokens = 0;
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
    // เลือกไฟล์ที่จะทำ RAG
    const RAG_EXTS = new Set([".pdf", ".xls", ".xlsx"]);
    function isRagFile(filename) {
      const ext = path.extname(filename || "").toLowerCase();
      return RAG_EXTS.has(ext);
    }
    function splitFilesForRag(fileArray = []) {
      const ragFiles = [];
      const directFiles = [];
      for (const fn of fileArray) {
        if (!fn) continue;
        if (isRagFile(fn)) ragFiles.push(fn);
        else directFiles.push(fn);
      }
      return { ragFiles, directFiles };
    }
    
    // ✅ สะสม token จากการถอดเสียงใน processFiles (mp3/mp4/webm ใน history เป็นต้น)
    let mediaUsageTotal = { 
      input_tokens: 0, 
      output_tokens: 0, 
      total_tokens: 0 
    };

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

    // ✅ สร้าง history: ไฟล์ non-rag ส่งเข้า prompt / ไฟล์ rag ใส่แค่ placeholder (ไม่ส่งเนื้อหา)
    for (const messageRow of messageAllByChatId) {
      const file_history = (messageRow?.files || [])
        .map((x) => x?.file_name)
        .filter(Boolean);

      const { ragFiles: ragHistoryFiles, directFiles: directHistoryFiles } =
        splitFilesForRag(file_history);

      const directParts = []; // ✅ ปิดประมวลผล + ไม่ส่งไฟล์ใน history

      const tag = String(messageRow?.message_type || "").trim().toUpperCase();

      // ✅ ถ้ามีไฟล์ (ไม่ว่าจะ rag/direct) และ tag เป็น IMAGE/DOC/VIDEO -> บังคับ role เป็น user
      const hasAnyFiles = (ragHistoryFiles.length + directHistoryFiles.length) > 0;
      const isTagWithFiles = ["IMAGE", "DOC", "VIDEO"].includes(tag) && hasAnyFiles;

      const role = isTagWithFiles ? "user" : messageRow.role;
      const isAssistant = role === "assistant";

      // ไม่ส่งคำว่า IMAGE/DOC/VIDEO เข้า prompt
      let textPart = isTagWithFiles ? "" : (messageRow.text || "");

      // ✅ กัน history ว่าง: ถ้ามีแต่ ragFiles และไม่มีข้อความ ให้ใส่ placeholder รายชื่อไฟล์
      if (!textPart && ragHistoryFiles.length > 0) {
        textPart =
          locale === "th"
            ? `แนบไฟล์สำหรับค้นหา (RAG): ${ragHistoryFiles.map(removeFirstPrefix).join(", ")}`
            : `Attached files for RAG search: ${ragHistoryFiles.map(removeFirstPrefix).join(", ")}`;
      }

      historyList.push({
        role,
        content: [
          {
            type: isAssistant ? "output_text" : "input_text",
            text: textPart,
          },
          ...directParts,
        ],
      });
    }
    console.log(historyList);

    // ✅ แยกไฟล์ webm (เฉพาะไฟล์ล่าสุดที่แนบมา)
    const webmFiles = fileMessageList_name.filter(
      (fn) => path.extname(fn || "").toLowerCase() === ".webm"
    );

    // ✅ สะสม usage ของการถอดเสียง webm
    let webmUsageTotal = { 
      input_tokens: 0, 
      output_tokens: 0, 
      total_tokens: 0 
    };

    let webmText = "";
    if (webmFiles.length > 0) {
      const texts = [];
      for (const fn of webmFiles) {
        const { text: t, usage } = await transcribeWebmToTextGpt(fn);

        if (t) texts.push(t);

        webmUsageTotal = addUsageOpenAI(webmUsageTotal, usage || {});
      }
      webmText = texts.join("\n");
    }

    // ✅ ถ้ามี text จาก webm -> ใช้ webmText อย่างเดียว (ไม่ใช้ message)
    const effectiveMessage = (webmText && webmText.trim().length > 0)
      ? webmText.trim()
      : String(message || "").trim();

    // เก็บคำถามล่าสุดที่ถามใน array
    const messagePrompt = {
      role: "user",
      content: [
        { type: "input_text", text: effectiveMessage },
        // สำหรับส่งไฟล์ไปที่ model
      ],
    };

    historyList.push(messagePrompt);
    //console.log(messagePrompt);

    console.log("historyList", historyList);

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { files, response, usage, cost_usd, token_equivalent } = await openaiGenerateVideo(historyList, {
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

    // ✅ รวม token: (webm ที่ถอดนอก processFiles) + (mp3/mp4 ที่ถอดใน processFiles)
    const extraUsageTotal = addUsageOpenAI(webmUsageTotal, mediaUsageTotal);
    const responseMerged = {
      ...response,
      usage: addUsageOpenAI(response?.usage || {}, extraUsageTotal),
    };
    // ✅ กอง B: ถามปกติ + mp3/mp4
    const responseMain = {
      usage: addUsageOpenAI(response?.usage, mediaUsageTotal)
    }
    // ✅ กอง A: webm อย่างเดียว
    const responseWebm = {
      usage: webmUsageTotal
    };

    console.log("responseMerged", responseMerged);
    console.log("responseMain", responseMain);
    console.log("responseWebm", responseWebm);

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
      const sendData = await Message.create({
        role: "user",
        message_type: message_type,
        text: effectiveMessage,
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

    // บันทึกของ responseWebm เปลี่ยนด้วยเสียง
    if (responseWebm?.usage.total_tokens !== 0) {
      try {
        await upsertDailyUserToken({
          aiId: chatOne?.ai?.id,
          userId: chatOne?.user_id,
          response: responseWebm,
        });
      } catch (error) {
        console.log(error);
      }
      const usedTranTokens = responseWebm?.usage.total_tokens ?? 0;
      // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
      try {
        // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
        await updateTokenAndNotify({
          ctx,
          chatOne,
          findRealModel: chatOne?.ai,
          usedTokens: usedTranTokens,
          // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
          // transaction: t,       // ถ้ามี transaction อยู่ใน scope
        });

      } catch (error) {
        console.log(error);
      }
    }

    // บันทึกของ response หลัก
    try {
      await upsertDailyUserToken({
        aiId: findRealModel?.id,
        userId: chatOne?.user_id,
        response: responseMain,
      });
    } catch (error) {
      console.log(error);
    }
    const usedTokens = responseMain.usage.total_tokens ?? 0;
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
  const fileMessageList_id = list
    .filter((x) => path.extname(x?.filename || "").toLowerCase() !== ".webm")
    .map(x => x?.id)
    .filter(v => v != null);

  // ดึงข้อมูลของ chat ทั้งหมดที่อยู่ใน chatgroup นี้
  const messageAllByChatId = await Message.findAll({
    order: [["id", "ASC"]],
    where: { chat_id: chat_id },
    include: [
      {
        model: File,                // ต้องมี association: Chatgroup.hasMany(Chat, { as: 'chat', foreignKey: 'chatgroup_id' })
        as: 'files',
        attributes: ["file_name"],
        required: false, // บังคับว่าต้องแมตช์ role ด้วย
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
      const file_history = (message?.files || [])
        .map(x => x?.file_name)
        .filter(Boolean);

      const fileParts = []; // <-- แค่นี้พอ (แทน await processFiles(file_history))

      const textTag = String(message?.message_type || "").trim().toUpperCase();

      const isTagWithFiles =
        ["IMAGE", "DOC", "VIDEO"].includes(textTag) && fileParts.length > 0;

      const role = isTagWithFiles ? "user" : message.role;

      const history = {
        role,
        parts: [
          { text: isTagWithFiles ? "" : (message.text || "") },
          ...fileParts,
        ],
      };
      historyList.push(history);
    }
    console.log(historyList);

    // เก็บคำถามล่าสุดที่ถามใน array
    // ✅ แยกไฟล์ webm ออกมาก่อน
    const webmFiles = fileMessageList_name.filter(
      (fn) => path.extname(fn || "").toLowerCase() === ".webm"
    );

    // ✅ สะสม token ของการถอดเสียง webm
    let webmUsageTotal = {
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      thoughtsTokenCount: 0,
      toolUsePromptTokenCount: 0,
      totalTokenCount: 0,
    };

    // ✅ ถอดเสียง webm ทั้งหมด (ถ้ามีหลายไฟล์ก็รวมกัน)
    let webmText = "";
    if (webmFiles.length > 0) {
      const texts = [];
      for (const fn of webmFiles) {
        const { text: t, response: trResp } = await transcribeWebmToTextGemini(fn, locale, findRealModel?.model_name);

        if (t) texts.push(t);

        // ✅ รวม token ของรอบถอดเสียง
        webmUsageTotal = addUsageGemini(webmUsageTotal, trResp?.usageMetadata || {});
      }
      webmText = texts.join("\n");
    }

    // ✅ ข้อความจริงที่จะใช้ทั้ง “ส่งให้โมเดล” และ “เก็บลง DB”
    // ✅ ถ้ามี text จาก webm -> ใช้ webmText อย่างเดียว (ไม่ใช้ message)
    const effectiveMessage = (webmText && webmText.trim().length > 0)
      ? webmText.trim()
      : String(message || "").trim();

    // ✅ ส่งเข้า processFiles เฉพาะไฟล์ที่ไม่ใช่ webm (กันข้อความซ้ำ)
    const nonWebmFiles = fileMessageList_name.filter(
      (fn) => path.extname(fn || "").toLowerCase() !== ".webm"
    );

    const filteredFiles = await processFiles(nonWebmFiles);

    const messageList = [
      { text: effectiveMessage },
      ...filteredFiles,
    ];
    console.log(messageList);

    console.log("messageList", messageList);
    console.log("historyList", historyList);

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

    // ✅ แยก response งานถอดเสียง
    const responseTranscribe = {
      usageMetadata: webmUsageTotal,
    };
    console.log("responseTranscribe", responseTranscribe);

    // ✅ รวม token ของ "ถอดเสียง webm" เข้ากับ token ของ "คำตอบหลัก"
    const mergedUsage = addUsageGemini(response?.usageMetadata || {}, webmUsageTotal);

    // ✅ สร้าง responseMerged เพื่อใช้ต่อทั้งบันทึก DB + quota
    const responseMerged = { ...response, usageMetadata: mergedUsage };

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
      const sendData = await Message.create({
        role: "user",
        message_type: message_type,
        text: effectiveMessage,
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
      const answerData = await Message.create({
        role: "model",
        message_type: message_type,
        text: "",
        file: fileIdsStr,
        input_token: responseMerged.usageMetadata.promptTokenCount,
        output_token:
          (responseMerged?.usageMetadata?.candidatesTokenCount ?? 0) +
          (responseMerged?.usageMetadata?.thoughtsTokenCount ?? 0) +
          (responseMerged?.usageMetadata?.toolUsePromptTokenCount ?? 0),
        total_token: responseMerged.usageMetadata.totalTokenCount,
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

    // บันทึกของ responseTranscribe เปลี่ยนด้วยเสียง
    if (responseTranscribe?.usageMetadata?.totalTokenCount !== 0) {
      try {
        await upsertDailyUserToken({
          aiId: findRealModel?.id,
          userId: chatOne?.user_id,
          response: responseTranscribe,
        });
      } catch (error) {
        console.log(error);
      }
      const usedTranTokens = responseTranscribe?.usageMetadata?.totalTokenCount ?? 0;
      // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
      try {
        // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
        await updateTokenAndNotify({
          ctx,
          chatOne,
          findRealModel,
          usedTokens: usedTranTokens,
          // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
          // transaction: t,       // ถ้ามี transaction อยู่ใน scope
        });

      } catch (error) {
        console.log(error);
      }
    }
    
    // บันทึกของ response หลัก
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
    // เลือกไฟล์ที่จะทำ RAG
    const RAG_EXTS = new Set([".pdf", ".xls", ".xlsx"]);
    function isRagFile(filename) {
      const ext = path.extname(filename || "").toLowerCase();
      return RAG_EXTS.has(ext);
    }
    function splitFilesForRag(fileArray = []) {
      const ragFiles = [];
      const directFiles = [];
      for (const fn of fileArray) {
        if (!fn) continue;
        if (isRagFile(fn)) ragFiles.push(fn);
        else directFiles.push(fn);
      }
      return { ragFiles, directFiles };
    }
    
    // ✅ สะสม token จากการถอดเสียงใน processFiles (mp3/mp4/webm ใน history เป็นต้น)
    let mediaUsageTotal = { 
      input_tokens: 0, 
      output_tokens: 0, 
      total_tokens: 0 
    };

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

    // ✅ สร้าง history: ไฟล์ non-rag ส่งเข้า prompt / ไฟล์ rag ใส่แค่ placeholder (ไม่ส่งเนื้อหา)
    for (const messageRow of messageAllByChatId) {
      const file_history = (messageRow?.files || [])
        .map((x) => x?.file_name)
        .filter(Boolean);

      const { ragFiles: ragHistoryFiles, directFiles: directHistoryFiles } =
        splitFilesForRag(file_history);

      const directParts = []; // ✅ ปิดประมวลผล + ไม่ส่งไฟล์ใน history

      const tag = String(messageRow?.message_type || "").trim().toUpperCase();

      // ✅ ถ้ามีไฟล์ (ไม่ว่าจะ rag/direct) และ tag เป็น IMAGE/DOC/VIDEO -> บังคับ role เป็น user
      const hasAnyFiles = (ragHistoryFiles.length + directHistoryFiles.length) > 0;
      const isTagWithFiles = ["IMAGE", "DOC", "VIDEO"].includes(tag) && hasAnyFiles;

      const role = isTagWithFiles ? "user" : messageRow.role;
      const isAssistant = role === "assistant";

      // ไม่ส่งคำว่า IMAGE/DOC/VIDEO เข้า prompt
      let textPart = isTagWithFiles ? "" : (messageRow.text || "");

      // ✅ กัน history ว่าง: ถ้ามีแต่ ragFiles และไม่มีข้อความ ให้ใส่ placeholder รายชื่อไฟล์
      if (!textPart && ragHistoryFiles.length > 0) {
        textPart =
          locale === "th"
            ? `แนบไฟล์สำหรับค้นหา (RAG): ${ragHistoryFiles.map(removeFirstPrefix).join(", ")}`
            : `Attached files for RAG search: ${ragHistoryFiles.map(removeFirstPrefix).join(", ")}`;
      }

      historyList.push({
        role,
        content: [
          {
            type: isAssistant ? "output_text" : "input_text",
            text: textPart,
          },
          ...directParts,
        ],
      });
    }
    console.log(historyList);

    // ✅ แยกไฟล์ webm (เฉพาะไฟล์ล่าสุดที่แนบมา)
    const webmFiles = fileMessageList_name.filter(
      (fn) => path.extname(fn || "").toLowerCase() === ".webm"
    );

    // ✅ สะสม usage ของการถอดเสียง webm
    let webmUsageTotal = { 
      input_tokens: 0, 
      output_tokens: 0, 
      total_tokens: 0 
    };

    let webmText = "";
    if (webmFiles.length > 0) {
      const texts = [];
      for (const fn of webmFiles) {
        const { text: t, usage } = await transcribeWebmToTextGpt(fn);

        if (t) texts.push(t);

        webmUsageTotal = addUsageOpenAI(webmUsageTotal, usage || {});
      }
      webmText = texts.join("\n");
    }

    // ✅ ถ้ามี text จาก webm -> ใช้ webmText อย่างเดียว (ไม่ใช้ message)
    const effectiveMessage = (webmText && webmText.trim().length > 0)
      ? webmText.trim()
      : String(message || "").trim();

    // เก็บคำถามล่าสุดที่ถามใน array
    const messagePrompt = {
      role: "user",
      content: [
        { type: "input_text", text: effectiveMessage },
        // สำหรับส่งไฟล์ไปที่ model
      ],
    };

    historyList.push(messagePrompt);
    //console.log(messagePrompt);

    console.log("historyList", historyList);

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { files, response } = await openaiGenerateExcel(historyList, {
      model: findRealModel?.model_name,     // เช่น "gpt-5" / "gpt-5-mini" ฯลฯ
      outDir: "./uploads",
      fileBase: `${Date.now()}-gen-doc`,
    });

    console.log(response.usage);
    console.log("saved:", files);

    // ✅ รวม token: (webm ที่ถอดนอก processFiles) + (mp3/mp4 ที่ถอดใน processFiles)
    const extraUsageTotal = addUsageOpenAI(webmUsageTotal, mediaUsageTotal);
    const responseMerged = {
      ...response,
      usage: addUsageOpenAI(response?.usage || {}, extraUsageTotal),
    };
    // ✅ กอง B: ถามปกติ + mp3/mp4
    const responseMain = {
      usage: addUsageOpenAI(response?.usage, mediaUsageTotal)
    }
    // ✅ กอง A: webm อย่างเดียว
    const responseWebm = {
      usage: webmUsageTotal
    };

    console.log("responseMerged", responseMerged);
    console.log("responseMain", responseMain);
    console.log("responseWebm", responseWebm);

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
      const sendData = await Message.create({
        role: "user",
        message_type: message_type,
        text: effectiveMessage,
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
      const answerData = await Message.create({
        role: "assistant",
        message_type: message_type,
        text: "",
        file: fileIdsStr,
        input_token: responseMerged.usage.input_tokens,
        output_token: responseMerged.usage.output_tokens,
        total_token: responseMerged.usage.total_tokens,
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

    // บันทึกของ responseWebm เปลี่ยนด้วยเสียง
    if (responseWebm?.usage.total_tokens !== 0) {
      try {
        await upsertDailyUserToken({
          aiId: findRealModel?.id,
          userId: chatOne?.user_id,
          response: responseWebm,
        });
      } catch (error) {
        console.log(error);
      }
      const usedTranTokens = responseWebm?.usage.total_tokens ?? 0;
      // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
      try {
        // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
        await updateTokenAndNotify({
          ctx,
          chatOne,
          findRealModel,
          usedTokens: usedTranTokens,
          // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
          // transaction: t,       // ถ้ามี transaction อยู่ใน scope
        });

      } catch (error) {
        console.log(error);
      }
    }

    // บันทึกของ response หลัก
    try {
      await upsertDailyUserToken({
        aiId: findRealModel?.id,
        userId: chatOne?.user_id,
        response: responseMain,
      });
    } catch (error) {
      console.log(error);
    }
    const usedTokens = responseMain.usage.total_tokens ?? 0;
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
        required: false, // บังคับว่าต้องแมตช์ role ด้วย
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
  const fileMessageList_id = list
    .filter((x) => path.extname(x?.filename || "").toLowerCase() !== ".webm")
    .map(x => x?.id)
    .filter(v => v != null);

  // ดึงข้อมูลของ chat ทั้งหมดที่อยู่ใน chatgroup นี้
  const messageAllByChatId = await Message.findAll({
    order: [["id", "ASC"]],
    where: { chat_id: chat_id },
    include: [
      {
        model: File,                // ต้องมี association: Chatgroup.hasMany(Chat, { as: 'chat', foreignKey: 'chatgroup_id' })
        as: 'files',
        attributes: ["file_name"],
        required: false, // บังคับว่าต้องแมตช์ role ด้วย
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
      const file_history = (message?.files || [])
        .map(x => x?.file_name)
        .filter(Boolean);

      const fileParts = await processFiles(file_history);

      const textTag = String(message?.message_type || "").trim().toUpperCase();

      const isTagWithFiles =
        ["IMAGE", "DOC", "VIDEO"].includes(textTag) && fileParts.length > 0;

      const role = isTagWithFiles ? "user" : message.role;

      const history = {
        role,
        parts: [
          { text: isTagWithFiles ? "" : (message.text || "") },
          ...fileParts,
        ],
      };
      historyList.push(history);
    }
    console.log(historyList);

    // เก็บคำถามล่าสุดที่ถามใน array
    // ✅ แยกไฟล์ webm ออกมาก่อน
    const webmFiles = fileMessageList_name.filter(
      (fn) => path.extname(fn || "").toLowerCase() === ".webm"
    );

    // ✅ สะสม token ของการถอดเสียง webm
    let webmUsageTotal = {
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      thoughtsTokenCount: 0,
      toolUsePromptTokenCount: 0,
      totalTokenCount: 0,
    };

    // ✅ ถอดเสียง webm ทั้งหมด (ถ้ามีหลายไฟล์ก็รวมกัน)
    let webmText = "";
    if (webmFiles.length > 0) {
      const texts = [];
      for (const fn of webmFiles) {
        const { text: t, response: trResp } = await transcribeWebmToTextGemini(fn, locale, findRealModel?.model_name);

        if (t) texts.push(t);

        // ✅ รวม token ของรอบถอดเสียง
        webmUsageTotal = addUsageGemini(webmUsageTotal, trResp?.usageMetadata || {});
      }
      webmText = texts.join("\n");
    }

    // ✅ ข้อความจริงที่จะใช้ทั้ง “ส่งให้โมเดล” และ “เก็บลง DB”
    // ✅ ถ้ามี text จาก webm -> ใช้ webmText อย่างเดียว (ไม่ใช้ message)
    const effectiveMessage = (webmText && webmText.trim().length > 0)
      ? webmText.trim()
      : String(message || "").trim();

    // ✅ ส่งเข้า processFiles เฉพาะไฟล์ที่ไม่ใช่ webm (กันข้อความซ้ำ)
    const nonWebmFiles = fileMessageList_name.filter(
      (fn) => path.extname(fn || "").toLowerCase() !== ".webm"
    );

    const filteredFiles = await processFiles(nonWebmFiles);

    const messageList = [
      { text: effectiveMessage },
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

    console.log("messageList", messageList);
    console.log("historyList", historyList);

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { text, response } = await geminiChat(
      messageList,
      historyList,
      findRealModel?.model_name,
      { enableGoogleSearch } // ✅ ถ้ามี pdf/doc/xls/ppt/mp4 ใน history/ล่าสุด => ปิด googleSearch
    );
    console.log("text", text);
    console.log("response", response);

    // ✅ แยก response งานถอดเสียง
    const responseTranscribe = {
      usageMetadata: webmUsageTotal,
    };
    console.log("responseTranscribe", responseTranscribe);

    // ✅ รวม token ของ "ถอดเสียง webm" เข้ากับ token ของ "คำตอบหลัก"
    const mergedUsage = addUsageGemini(response?.usageMetadata || {}, webmUsageTotal);

    // ✅ สร้าง responseMerged เพื่อใช้ต่อทั้งบันทึก DB + quota
    const responseMerged = { ...response, usageMetadata: mergedUsage };

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
        text: effectiveMessage, // ✅ ใช้ข้อความจาก webm (รวมกับ message ถ้ามี)
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
        input_token: responseMerged.usageMetadata.promptTokenCount,
        output_token:
          (responseMerged?.usageMetadata?.candidatesTokenCount ?? 0) +
          (responseMerged?.usageMetadata?.thoughtsTokenCount ?? 0) +
          (responseMerged?.usageMetadata?.toolUsePromptTokenCount ?? 0),
        total_token: responseMerged.usageMetadata.totalTokenCount,
        chat_id: chat_id,
      });
    } catch (error) {
      console.log(error);
    }

    // บันทึกของ responseTranscribe เปลี่ยนด้วยเสียง
    if (responseTranscribe?.usageMetadata?.totalTokenCount !== 0) {
      try {
        await upsertDailyUserToken({
          aiId: findRealModel?.id,
          userId: chatOne?.user_id,
          response: responseTranscribe,
        });
      } catch (error) {
        console.log(error);
      }
      const usedTranTokens = responseTranscribe?.usageMetadata?.totalTokenCount ?? 0;
      // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
      try {
        // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
        await updateTokenAndNotify({
          ctx,
          chatOne,
          findRealModel,
          usedTokens: usedTranTokens,
          // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
          // transaction: t,       // ถ้ามี transaction อยู่ใน scope
        });

      } catch (error) {
        console.log(error);
      }
    }

    // บันทึกของ response หลัก
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
    // ✅ สะสม token จากการถอดเสียงใน processFiles (mp3/mp4/webm ใน history เป็นต้น)
    let mediaUsageTotal = { 
      input_tokens: 0, 
      output_tokens: 0, 
      total_tokens: 0 
    };

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
            const { text: transcript, usage } = await transcribeAudio(filePath);
            console.log("transcript", transcript);
            console.log("usage", usage);

            // ✅ รวม token จากการถอดเสียง mp3
            mediaUsageTotal = addUsageOpenAI(mediaUsageTotal, usage || {});

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
      const file_history = (message?.files || [])
        .map(x => x?.file_name)
        .filter(Boolean);

      const fileParts = await processFiles(file_history);

      const tag = String(message?.message_type || "").trim().toUpperCase();
      const isTagWithFiles = ["IMAGE", "DOC", "VIDEO"].includes(tag) && fileParts.length > 0;

      // ✅ บังคับ role เป็น user ถ้าเข้าเงื่อนไข IMAGE/DOC/VIDEO และมีไฟล์
      const role = isTagWithFiles ? "user" : message.role;

      // ✅ ใช้ role หลัง override ในการกำหนดชนิดข้อความ
      const isAssistant = role === "assistant";

      const history = {
        role,
        content: [
          {
            type: isAssistant ? "output_text" : "input_text",
            // ✅ ไม่ต้องส่งคำว่า IMAGE/DOC/VIDEO เข้า prompt
            text: isTagWithFiles ? "" : (message.text || ""),
          },
          ...fileParts,
        ],
      };
      historyList.push(history);
    }
    console.log(historyList);

    // ✅ แยกไฟล์ webm (เฉพาะไฟล์ล่าสุดที่แนบมา)
    const webmFiles = fileMessageList_name.filter(
      (fn) => path.extname(fn || "").toLowerCase() === ".webm"
    );

    // ✅ สะสม usage ของการถอดเสียง webm
    let webmUsageTotal = { 
      input_tokens: 0, 
      output_tokens: 0, 
      total_tokens: 0 
    };

    let webmText = "";
    if (webmFiles.length > 0) {
      const texts = [];
      for (const fn of webmFiles) {
        const { text: t, usage } = await transcribeWebmToTextGpt(fn);

        if (t) texts.push(t);

        webmUsageTotal = addUsageOpenAI(webmUsageTotal, usage || {});
      }
      webmText = texts.join("\n");
    }

    // ✅ ถ้ามี text จาก webm -> ใช้ webmText อย่างเดียว (ไม่ใช้ message)
    const effectiveMessage = (webmText && webmText.trim().length > 0)
      ? webmText.trim()
      : String(message || "").trim();

    // รวมชื่อไฟล์จาก history (ที่ดึงมาจาก DB) + ไฟล์ล่าสุดที่ผู้ใช้แนบมา
    const historyFileNames = (messageAllByChatId || [])
      .flatMap(m => (m.files || []).map(f => f.file_name).filter(Boolean));

    const allFileNamesForSearch = [
      ...historyFileNames,
      ...fileMessageList_name,
    ];

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
    //console.log(messagePrompt);

    console.log("historyList", historyList);

    // ส่งประวัติ prompt และคำถามล่าสุดไปในคำนวนและ return คำตอบออกมา
    const { text, response, enableSearch } = await openAiChat(
      historyList,
      findRealModel?.model_name,
      { fileNames: allFileNamesForSearch }   // ✅ สำคัญ
    );
    console.log("text", text);
    console.log("response", response);

    // ✅ รวม token: (webm ที่ถอดนอก processFiles) + (mp3/mp4 ที่ถอดใน processFiles)
    const extraUsageTotal = addUsageOpenAI(webmUsageTotal, mediaUsageTotal);
    const responseMerged = {
      ...response,
      usage: addUsageOpenAI(response?.usage || {}, extraUsageTotal),
    };
    // ✅ กอง B: ถามปกติ + mp3/mp4
    const responseMain = {
      usage: addUsageOpenAI(response?.usage, mediaUsageTotal)
    }
    // ✅ กอง A: webm อย่างเดียว
    const responseWebm = {
      usage: webmUsageTotal
    };

    console.log("responseMerged", responseMerged);
    console.log("responseMain", responseMain);
    console.log("responseWebm", responseWebm);

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
        text: effectiveMessage,
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
        input_token: responseMerged.usage.input_tokens,
        output_token: responseMerged.usage.output_tokens,
        total_token: responseMerged.usage.total_tokens,
        chat_id: chat_id,
      });
    } catch (error) {
      console.log(error);
    }

    // บันทึกของ responseWebm เปลี่ยนด้วยเสียง
    if (responseWebm?.usage.total_tokens !== 0) {
      try {
        await upsertDailyUserToken({
          aiId: findRealModel?.id,
          userId: chatOne?.user_id,
          response: responseWebm,
        });
      } catch (error) {
        console.log(error);
      }
      const usedTranTokens = responseWebm?.usage.total_tokens ?? 0;
      // ลบจำนวน token ที่ใช้จาก token ทั้งหมดของ model ของ user
      try {
        // อัปเดต token + เช็ค % แล้วส่งแจ้งเตือน
        await updateTokenAndNotify({
          ctx,
          chatOne,
          findRealModel,
          usedTokens: usedTranTokens,
          // thresholdPercent: 15, // ไม่ส่งก็ได้ ใช้ default 15
          // transaction: t,       // ถ้ามี transaction อยู่ใน scope
        });

      } catch (error) {
        console.log(error);
      }
    }

    // บันทึกของ response หลัก
    try {
      await upsertDailyUserToken({
        aiId: findRealModel?.id,
        userId: chatOne?.user_id,
        response: responseMain,
      });
    } catch (error) {
      console.log(error);
    }
    const usedTokens = responseMain.usage.total_tokens ?? 0;
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
