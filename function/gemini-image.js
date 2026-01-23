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
 * historyList: [{ role:"user"|"model", parts:[...] }, ...]
 * messageList: [{text:"..."}, {inlineData:{...}}, {fileData:{...}}, ...]
 */
exports.geminiGenerateImage = async (
  historyList,
  messageList,
  {
    model = "gemini-3-pro-image-preview",
    outDir = "./uploads",
    fileBase = "nano-banana",
    aspectRatio = "1:1",
  } = {}
) => {
  const ai = await getAI();
  fs.mkdirSync(outDir, { recursive: true });

  // ✅ รวม history + prompt ล่าสุดใน request เดียว
  const contents = [
    ...(Array.isArray(historyList) ? historyList : []),
    {
      role: "user",
      parts: Array.isArray(messageList) ? messageList : [{ text: String(messageList ?? "") }],
    },
  ];

  const resp = await ai.models.generateContent({
    model,
    contents,
    config: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio },
    },
  });

  const parts = resp?.candidates?.[0]?.content?.parts ?? [];
  const imageParts = parts.filter((p) => p?.inlineData?.data);

  if (imageParts.length === 0) {
    // debug ช่วยดูว่ามีอะไรกลับมาบ้าง
    // console.log(JSON.stringify(parts, null, 2));
    throw new Error("No image returned (inlineData not found).");
  }

  const saved = imageParts.map((p, idx) => {
    const mime = p.inlineData.mimeType || "image/png";
    const ext = mime.includes("png") ? "png" : mime.includes("jpeg") ? "jpg" : "bin";
    const outPath = path.join(outDir, `${fileBase}-${idx + 1}.${ext}`);
    fs.writeFileSync(outPath, Buffer.from(p.inlineData.data, "base64"));
    return outPath;
  });

  const text = parts
    .filter((p) => typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();

  return { files: saved, text, response: resp };
};
