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
    const content = Array.isArray(msg?.content) ? msg.content : Array.isArray(msg?.parts) ? msg.parts : [];

    const texts = content
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .filter(Boolean);

    if (texts.length) {
      // ใส่ role ช่วยให้ prompt อ่านง่ายขึ้น (คล้ายรวม history)
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
      // รองรับ shape ที่พบบ่อยใน Responses: {type:"input_image", image_url:"data:..."} หรือ {image_url:{url:"data:..."}}
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

function pickSize({ size, aspectRatio = "16:9", quality = "standard" } = {}) {
  // allowed values ตาม API: 720x1280, 1280x720, 1024x1792, 1792x1024 :contentReference[oaicite:2]{index=2}
  if (size) return size;

  const hi = ["high", "large", "pro", "hd"].includes(String(quality).toLowerCase());
  const ar = String(aspectRatio).trim();

  if (ar === "9:16") return hi ? "1024x1792" : "720x1280";
  if (ar === "16:9") return hi ? "1792x1024" : "1280x720";

  // fallback
  return hi ? "1792x1024" : "1280x720";
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
    throw new Error(`Invalid size "${size}". Allowed: 720x1280, 1280x720, 1024x1792, 1792x1024`);
  }
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
 * - quality: "standard" | "high"   (แค่เลือก size ให้ใหญ่ขึ้น)
 * - size: "1280x720" | "720x1280" | "1792x1024" | "1024x1792"  (ถ้าส่งมา จะ override)
 * - outDir: "./uploads"
 * - fileBase: "gen-video"
 * - pollIntervalMs: 15000
 * - timeoutMs: 10 * 60_000
 * - inputReferencePath: "path/to/image.png"  (ถ้าไม่ส่ง จะพยายาม auto-detect จาก historyList data URL)
 *
 * return:
 * { files:[mp4Path], text:"", response: videoJob, prompt, usedImage:boolean, usage:{...tokens=0} }
 */
exports.openaiGenerateVideo = async (
  historyList,
  {
    model = "sora-2",
    seconds = 8,
    aspectRatio = "16:9",
    size = "1280x720",
    quality = "standard",
    outDir = "./uploads",
    fileBase = "gen-video",
    pollIntervalMs = 15_000,
    timeoutMs = 10 * 60_000,
    inputReferencePath, // optional: ให้ path รูปมาเอง
  } = {}
) => {
  const openai = await getOpenAI();
  fs.mkdirSync(outDir, { recursive: true });

  const prompt = extractAllTexts(historyList);
  if (!prompt) throw new Error("Prompt is empty (no text found in historyList).");

  const finalSize = pickSize({ size, aspectRatio, quality });
  validateParams({ model, seconds, size: finalSize });

  // ------------------------------
  // input_reference (optional)
  // - ถ้ามี inputReferencePath ใช้อันนั้น
  // - ไม่งั้นลองหา data-url image ล่าสุดใน historyList แล้วแปลงเป็นไฟล์ชั่วคราว
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
    size: finalSize,
    ...(inputRefStream ? { input_reference: inputRefStream } : {}),
  };

  let video = await openai.videos.create(createReq);

  // ------------------------------
  // 2) poll until completed/failed
  // ------------------------------
  const start = Date.now();
  while (video?.status === "queued" || video?.status === "in_progress") {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for video generation (>${timeoutMs} ms). Last status=${video?.status}`);
    }
    await sleep(pollIntervalMs);
    video = await openai.videos.retrieve(video.id);
  }

  if (video?.status !== "completed") {
    const msg = video?.error?.message || `Video generation failed. Status=${video?.status || "unknown"}`;
    throw new Error(msg);
  }

  // ------------------------------
  // 3) download mp4 bytes (default variant is MP4)
  // ------------------------------
  const res = await openai.videos.downloadContent(video.id);
  const blob = await res.blob();
  const buf = Buffer.from(await blob.arrayBuffer());

  const outPath = path.join(outDir, `${fileBase}.mp4`);
  fs.writeFileSync(outPath, buf);

  // Video API ไม่มี usage แบบ token เหมือน text/image -> คืน 0 ไว้ให้โค้ด downstream ไม่พัง
  const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  return {
    files: [outPath],
    text: "",
    response: video, // video job metadata
    prompt,
    usedImage,
    usage,
  };
};
