"use strict";

const fs = require("node:fs");
const path = require("node:path");

let _openaiPromise = null;

async function getOpenAI() {
  if (!_openaiPromise) {
    _openaiPromise = (async () => {
      const { default: OpenAI } = await import("openai");
      return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    })();
  }
  return _openaiPromise;
}

// ------------------------------
// helpers
// ------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractAllTexts(historyList) {
  const list = Array.isArray(historyList) ? historyList : [];
  const lines = [];

  for (const msg of list) {
    const role = msg?.role || "user";
    const content = Array.isArray(msg?.content)
      ? msg.content
      : Array.isArray(msg?.parts)
        ? msg.parts
        : [];

    const texts = content
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .filter(Boolean);

    if (texts.length) {
      lines.push(`${String(role).toUpperCase()}: ${texts.join("\n")}`);
    }
  }

  return lines.join("\n").trim();
}

function findLastDataUrlImage(historyList) {
  const list = Array.isArray(historyList) ? historyList : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const content = Array.isArray(list[i]?.content) ? list[i].content : [];
    for (let j = content.length - 1; j >= 0; j--) {
      const p = content[j] || {};
      const url =
        typeof p.image_url === "string"
          ? p.image_url
          : typeof p.image_url?.url === "string"
            ? p.image_url.url
            : null;

      if (url && url.startsWith("data:image/") && url.includes(";base64,")) return url;
    }
  }
  return null;
}

function saveDataUrlImageToFile(dataUrl, outDir, fileBase = "input_reference") {
  const m = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (!m) throw new Error("Invalid data URL for image (expected data:image/...;base64,...)");

  const mimeType = m[1];
  const b64 = m[2];

  const ext =
    mimeType.includes("png") ? "png" :
    mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" :
    mimeType.includes("webp") ? "webp" :
    "bin";

  const outPath = path.join(outDir, `${fileBase}.${ext}`);
  fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
  return { outPath, mimeType };
}

function pick720pSize(aspectRatio = "16:9") {
  const ar = String(aspectRatio).trim();
  // บังคับ 720p เท่านั้น
  if (ar === "9:16") return "720x1280";  // portrait 720p
  return "1280x720";                     // landscape 720p (default)
}

function validateParams({ model, seconds, size }) {
  const allowedModels = new Set(["sora-2", "sora-2-pro"]);
  const allowedSeconds = new Set(["4", "8", "12", 4, 8, 12]);
  const allowedSizes = new Set(["720x1280", "1280x720", "1024x1792", "1792x1024"]);

  if (model && !allowedModels.has(model)) {
    throw new Error(`Invalid model "${model}". Allowed: sora-2, sora-2-pro`);
  }
  if (seconds != null && !allowedSeconds.has(seconds)) {
    throw new Error(`Invalid seconds "${seconds}". Allowed: 4, 8, 12`);
  }
  if (size && !allowedSizes.has(size)) {
    throw new Error(
      `Invalid size "${size}". Allowed: 720x1280, 1280x720, 1024x1792, 1792x1024`
    );
  }
}

// ------------------------------
// Pricing helpers
// ------------------------------

// ✅ Sora video pricing (USD per second) ตามหน้า pricing ณ ตอนอัปเดตโค้ดนี้
function estimateSoraCostUSD({ model, seconds, size }) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return 0;

  // 720p tiers
  if (model === "sora-2") {
    // Portrait 720x1280 / Landscape 1280x720
    return 0.10 * s;
  }
  if (model === "sora-2-pro") {
    // 720p = $0.30/sec, 1792x1024 (หรือ 1024x1792) = $0.50/sec
    const hiRes = size === "1792x1024" || size === "1024x1792";
    return (hiRes ? 0.50 : 0.30) * s;
  }
  return 0;
}

// ✅ GPT-5 pricing (USD per 1M tokens) — Standard processing
// (Input: $1.25 / 1M, Output: $10.00 / 1M)
const GPT5_PRICE_PER_1M = {
  input: 1.25,
  output: 10.0,
};

function usdToGpt5Tokens(usd, direction = "output") {
  const price = GPT5_PRICE_PER_1M[direction] ?? GPT5_PRICE_PER_1M.output;
  const u = Number(usd);
  if (!Number.isFinite(u) || u <= 0) return 0;

  // tokens = usd / (price_per_1_token) = usd / (price_per_1M / 1e6)
  const tokens = (u * 1_000_000) / price;
  return Math.round(tokens);
}

/**
 * openaiGenerateVideo(historyList, options)
 *
 * historyList: [{ role:"system"|"user"|"assistant", content:[{type:"input_text"|"output_text", text:"..."}, {type:"input_image", image_url:"data:..."} ...] }]
 *
 * options:
 * - model: "sora-2" | "sora-2-pro"
 * - seconds: 4 | 8 | 12
 * - aspectRatio: "16:9" | "9:16"
 * - outDir: "./uploads"
 * - fileBase: "gen-video"
 * - pollIntervalMs: 15000
 * - timeoutMs: 10 * 60_000
 * - inputReferencePath: "path/to/image.png"
 *
 * ✅ NOTE:
 * - size/quality ถูก “ignore” เพราะบังคับ 720p ทุกอันตาม requirement
 *
 * return:
 * {
 *   files:[mp4Path],
 *   text:"",
 *   response: videoJob,
 *   prompt,
 *   usedImage:boolean,
 *   cost_usd:number,
 *   token_equivalent:{ gpt5_input_tokens_eq, gpt5_output_tokens_eq, chosen_total_tokens, chosen_mode },
 *   usage:{ input_tokens, output_tokens, total_tokens }
 * }
 */
exports.openaiGenerateVideo = async (
  historyList,
  {
    model = "sora-2-pro",
    seconds = 8,
    aspectRatio = "16:9",
    // ⛔ size/quality ถูกบังคับ override ให้เป็น 720p เสมอ
    outDir = "./uploads",
    fileBase = "gen-video",
    pollIntervalMs = 15_000,
    timeoutMs = 10 * 60_000,
    inputReferencePath,
    // เลือกว่าจะ “คิด token เทียบ GPT-5” แบบไหน (default: output เพราะแพงสุด/กันโควต้าไม่เฟ้อ)
    tokenMode = "output", // "output" | "input"
  } = {}
) => {
  const openai = await getOpenAI();
  fs.mkdirSync(outDir, { recursive: true });

  const prompt = extractAllTexts(historyList);
  if (!prompt) throw new Error("Prompt is empty (no text found in historyList).");

  // ✅ บังคับ 720p ทุกครั้ง
  const finalSize = pick720pSize(aspectRatio);
  validateParams({ model, seconds, size: finalSize });

  // ------------------------------
  // input_reference (optional)
  // ------------------------------
  let inputRefStream = null;
  let usedImage = false;

  if (inputReferencePath) {
    inputRefStream = fs.createReadStream(inputReferencePath);
    usedImage = true;
  } else {
    const dataUrl = findLastDataUrlImage(historyList);
    if (dataUrl) {
      const { outPath } = saveDataUrlImageToFile(dataUrl, outDir, `${fileBase}-inputref`);
      inputRefStream = fs.createReadStream(outPath);
      usedImage = true;
    }
  }

  // ------------------------------
  // 1) create job
  // ------------------------------
  const createReq = {
    model,
    prompt,
    seconds: String(seconds),
    size: finalSize, // ✅ 720p เท่านั้น
    ...(inputRefStream ? { input_reference: inputRefStream } : {}),
  };

  let video = await openai.videos.create(createReq);

  // ------------------------------
  // 2) poll until completed/failed
  // ------------------------------
  const start = Date.now();
  while (video?.status === "queued" || video?.status === "in_progress") {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timeout waiting for video generation (>${timeoutMs} ms). Last status=${video?.status}`
      );
    }
    await sleep(pollIntervalMs);
    video = await openai.videos.retrieve(video.id);
  }

  if (video?.status !== "completed") {
    const msg = video?.error?.message || `Video generation failed. Status=${video?.status || "unknown"}`;
    throw new Error(msg);
  }

  // ------------------------------
  // 3) download mp4 bytes
  // ------------------------------
  const res = await openai.videos.downloadContent(video.id);
  const blob = await res.blob();
  const buf = Buffer.from(await blob.arrayBuffer());

  const outPath = path.join(outDir, `${fileBase}.mp4`);
  fs.writeFileSync(outPath, buf);

  // ------------------------------
  // 4) Cost -> GPT-5 token equivalent
  // ------------------------------
  const cost_usd = estimateSoraCostUSD({ model, seconds, size: finalSize });

  const gpt5_input_tokens_eq = usdToGpt5Tokens(cost_usd, "input");
  const gpt5_output_tokens_eq = usdToGpt5Tokens(cost_usd, "output");

  const chosen_total_tokens =
    String(tokenMode).toLowerCase() === "input" ? gpt5_input_tokens_eq : gpt5_output_tokens_eq;

  // ใส่ลง usage ให้ downstream เอาไปหักโควต้าได้เลย
  const usage = {
    input_tokens: 0,
    output_tokens: chosen_total_tokens,
    total_tokens: chosen_total_tokens,
  };

  return {
    files: [outPath],
    text: "",
    response: video,
    prompt,
    usedImage,
    cost_usd,
    token_equivalent: {
      gpt5_input_tokens_eq,
      gpt5_output_tokens_eq,
      chosen_total_tokens,
      chosen_mode: String(tokenMode).toLowerCase() === "input" ? "input" : "output",
    },
    usage,
  };
};
