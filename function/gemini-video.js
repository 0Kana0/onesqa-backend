"use strict";

const fs = require("node:fs");
const path = require("node:path");

let _aiPromise = null;

async function getAI() {
  if (!_aiPromise) {
    _aiPromise = (async () => {
      const { GoogleGenAI } = await import("@google/genai");
      return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    })();
  }
  return _aiPromise;
}

/**
 * historyList: [{ role:"user"|"model", parts:[{text?...}, {inlineData?...}, ...] }, ...]
 * messageList: [{text:"..."}, {inlineData:{mimeType,data}}, ...] | string
 *
 * หมายเหตุ:
 * - Veo generateVideos รับ "prompt" เป็น string (ไม่ใช่ contents แบบ generateContent)
 * - โค้ดนี้จะ "รวม text" จาก history + messageList เป็น prompt เดียว
 * - ถ้า messageList มี inlineData (image/*) จะใช้เป็น image-to-video (starting frame) อัตโนมัติ
 */
exports.geminiGenerateVideo = async (
  historyList,
  messageList,
  {
    model = "veo-3.1-generate-preview",
    outDir = "./uploads",
    fileBase = "veo-video",
    aspectRatio = "16:9", // "16:9" | "9:16"
    resolution, // optional: "720p" | "1080p" | "4k"
    pollIntervalMs = 10_000,
    timeoutMs = 10 * 60_000, // 10 นาที
    // optional: บังคับภาพเริ่มต้นเอง (ถ้าไม่อยากให้ auto-detect จาก messageList)
    inputImage, // { imageBytes: base64String, mimeType: "image/png" }
  } = {}
) => {
  const ai = await getAI();
  fs.mkdirSync(outDir, { recursive: true });

  // ---------- helper: เก็บ text จาก parts ----------
  const extractTextsFromParts = (parts) =>
    (Array.isArray(parts) ? parts : [])
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .filter(Boolean);

  // ---------- helper: หา image inlineData อันแรก (image/*) ----------
  const extractFirstInlineImage = (parts) => {
    const arr = Array.isArray(parts) ? parts : [];
    const hit = arr.find(
      (p) =>
        p?.inlineData?.data &&
        typeof p.inlineData.data === "string" &&
        typeof p.inlineData.mimeType === "string" &&
        p.inlineData.mimeType.startsWith("image/")
    );
    if (!hit) return null;

    return {
      imageBytes: hit.inlineData.data, // base64 string
      mimeType: hit.inlineData.mimeType,
    };
  };

  // ---------- 1) รวม prompt ----------
  const historyText = (Array.isArray(historyList) ? historyList : [])
    .flatMap((h) => extractTextsFromParts(h?.parts))
    .join("\n")
    .trim();

  let msgParts = null;
  if (Array.isArray(messageList)) msgParts = messageList;
  else if (messageList != null) msgParts = [{ text: String(messageList) }];

  const messageText = extractTextsFromParts(msgParts).join("\n").trim();

  const prompt = [historyText, messageText].filter(Boolean).join("\n").trim();
  if (!prompt) throw new Error("Prompt is empty (no text found in historyList/messageList).");

  // ---------- 2) auto-detect image-to-video ----------
  const detectedImage = inputImage || extractFirstInlineImage(msgParts);

  // ---------- 3) สร้าง request ----------
  const req = {
    model,
    prompt,
    ...(detectedImage ? { image: detectedImage } : {}),
    config: {
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(resolution ? { resolution } : {}),
    },
  };

  // ลบ config ถ้าว่าง (กันบาง SDK strict)
  if (!req.config || Object.keys(req.config).length === 0) delete req.config;

  // ---------- 4) เรียก generateVideos (เป็น long-running operation) ----------
  let operation = await ai.models.generateVideos(req);

  // ---------- 5) poll จนเสร็จ หรือ timeout ----------
  const start = Date.now();
  while (!operation?.done) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for video generation (>${timeoutMs} ms).`);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  // ---------- 6) ตรวจว่ามี video กลับมาจริง ----------
  const videoFile = operation?.response?.generatedVideos?.[0]?.video;
  if (!videoFile) {
    throw new Error("No video returned (operation.response.generatedVideos[0].video not found).");
  }

  // ---------- 7) ดาวน์โหลดไฟล์ mp4 ----------
  const outPath = path.join(outDir, `${fileBase}.mp4`);
  await ai.files.download({
    file: videoFile,
    downloadPath: outPath,
  });

  return {
    files: [outPath],
    text: "", // video generation ปกติไม่มี text output
    response: operation,
    prompt,
    usedImage: Boolean(detectedImage),
  };
};
