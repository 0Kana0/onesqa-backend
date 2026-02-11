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
 */
exports.geminiGenerateVideo = async (
  historyList,
  messageList,
  {
    model = "veo-3.1-fast-generate-preview",
    outDir = "./uploads",
    fileBase = "veo-video",
    aspectRatio = "16:9",
    // resolution จะถูก ignore และบังคับเป็น 720p เสมอ
    resolution,

    pollIntervalMs = 10_000,
    timeoutMs = 10 * 60_000,

    inputImage, // { imageBytes: base64String, mimeType: "image/png" }

    countTokens = true,
    tokenCountFallbackModel = "gemini-2.0-flash",

    // ✅ ส่งค่าเงินจริงที่ใช้ไป (USD) เพื่อให้คำนวณ cost_equivalent ได้
    spentUsd, // number เช่น 1.2
  } = {}
) => {
  const ai = await getAI();
  fs.mkdirSync(outDir, { recursive: true });

  // ---------- helper ----------
  const extractTextsFromParts = (parts) =>
    (Array.isArray(parts) ? parts : [])
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .filter(Boolean);

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
      imageBytes: hit.inlineData.data,
      mimeType: hit.inlineData.mimeType,
    };
  };

  // ✅ ราคา Gemini 2.5 Pro (Standard)
  function gemini25ProStandardPricePer1M(promptTokens) {
    const over = Number(promptTokens || 0) > 200_000;
    return {
      bracket: over ? ">200k" : "<=200k",
      inputUsdPer1M: over ? 2.5 : 1.25,
      outputUsdPer1M: over ? 15.0 : 10.0,
    };
  }

  function costUsdToTokens(costUsd, usdPer1M) {
    const c = Number(costUsd);
    const p = Number(usdPer1M);
    if (!Number.isFinite(c) || c <= 0) return 0;
    if (!Number.isFinite(p) || p <= 0) return 0;
    return Math.round((c / p) * 1_000_000);
  }

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

  // ---------- 2.5) นับ token ของ prompt ----------
  let tokenMeta = {
    modelUsed: null,
    fallbackUsed: false,
    promptTokenCount: null,
    totalTokens: null,
  };

  if (countTokens) {
    try {
      const r = await ai.models.countTokens({ model, contents: prompt });
      tokenMeta = {
        modelUsed: model,
        fallbackUsed: false,
        promptTokenCount: r?.totalTokens ?? null,
        totalTokens: r?.totalTokens ?? null,
      };
    } catch (e) {
      const r = await ai.models.countTokens({
        model: tokenCountFallbackModel,
        contents: prompt,
      });
      tokenMeta = {
        modelUsed: tokenCountFallbackModel,
        fallbackUsed: true,
        promptTokenCount: r?.totalTokens ?? null,
        totalTokens: r?.totalTokens ?? null,
      };
    }
  }

  // ---------- 3) request (บังคับ 720p) ----------
  const FORCED_RESOLUTION = "720p";

  const req = {
    model,
    prompt,
    ...(detectedImage ? { image: detectedImage } : {}),
    config: {
      ...(aspectRatio ? { aspectRatio } : {}),
      resolution: FORCED_RESOLUTION,
    },
  };

  if (!req.config || Object.keys(req.config).length === 0) delete req.config;

  // ---------- 4) generateVideos ----------
  let operation = await ai.models.generateVideos(req);

  // ---------- 5) poll ----------
  const start = Date.now();
  while (!operation?.done) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for video generation (>${timeoutMs} ms).`);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  // ---------- 6) check video ----------
  const videoFile = operation?.response?.generatedVideos?.[0]?.video;
  if (!videoFile) {
    throw new Error("No video returned (operation.response.generatedVideos[0].video not found).");
  }

  // ---------- 7) download mp4 ----------
  const outPath = path.join(outDir, `${fileBase}.mp4`);
  await ai.files.download({
    file: videoFile,
    downloadPath: outPath,
  });

  // ---------- 8) cost_equivalent ----------
  const promptTokens = Number(tokenMeta?.promptTokenCount ?? 0);
  const price = gemini25ProStandardPricePer1M(promptTokens);

  const costEquiv =
    Number.isFinite(Number(spentUsd)) && Number(spentUsd) > 0
      ? {
          basisModel: "gemini-2.5-pro",
          pricingTier: "standard",
          bracket: price.bracket,
          spentUsd: Number(spentUsd),
          inputUsdPer1M: price.inputUsdPer1M,
          outputUsdPer1M: price.outputUsdPer1M,
          equivalentInputTokens: costUsdToTokens(spentUsd, price.inputUsdPer1M),
          equivalentOutputTokens: costUsdToTokens(spentUsd, price.outputUsdPer1M),
        }
      : null;

  const input_token = promptTokens || 0;

  // ✅ ตามที่สั่ง: output_token ใช้ equivalentInputTokens
  const output_token = costEquiv?.equivalentInputTokens ?? 0;

  return {
    files: [outPath],
    text: "",
    response: operation,
    prompt,
    usedImage: Boolean(detectedImage),

    forcedResolution: FORCED_RESOLUTION,

    tokens: tokenMeta,
    input_token,
    output_token, // ✅ ใช้ equivalentInputTokens แล้ว
    cost_equivalent: costEquiv,
  };
};
