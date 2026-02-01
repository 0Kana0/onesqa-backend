// openaiGenerateImage.js
"use strict";

const fs = require("node:fs");
const path = require("node:path");

let _clientPromise = null;

async function getOpenAI() {
  if (!_clientPromise) {
    _clientPromise = (async () => {
      const mod = await import("openai");
      const OpenAI = mod.default;
      return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    })();
  }
  return _clientPromise;
}

function extFromOutputFormat(outputFormat = "png") {
  const f = String(outputFormat || "png").toLowerCase();
  if (f === "jpeg") return "jpg";
  if (f === "png") return "png";
  if (f === "webp") return "webp";
  return "png";
}

function normalizeSize({ size, aspectRatio }) {
  if (typeof size === "string" && size.trim()) return size.trim();
  const ar = String(aspectRatio || "1:1").trim().toLowerCase();
  if (ar === "auto") return "auto";
  if (ar === "1:1") return "1024x1024";
  if (ar === "16:9" || ar === "3:2" || ar === "4:3") return "1536x1024";
  if (ar === "9:16" || ar === "2:3" || ar === "3:4") return "1024x1536";
  if (/^\d{3,4}x\d{3,4}$/.test(ar)) return ar;
  return "1024x1024";
}

function isTextItem(it) {
  const t = it?.type;
  return (t === "input_text" || t === "output_text" || t === "text") && typeof it?.text === "string";
}

function isImageItem(it) {
  // รองรับแบบ Responses API:
  // { type:"input_image", image_url:{url:"..."} }
  // หรือ { type:"input_image", image_base64:"..." , mimeType? }
  return it?.type === "input_image";
}

function isLocalFileItem(it) {
  // รองรับกรณี processFiles ส่ง object ที่มี path/filePath/localPath + mimeType
  return (
    it?.type === "input_file" &&
    (it?.path || it?.filePath || it?.file_path || it?.localPath)
  );
}

function roleLabel(role) {
  if (role === "system") return "System";
  if (role === "assistant") return "Assistant";
  return "User";
}

function buildPromptFromHistory(historyList) {
  const lines = [];

  for (const msg of Array.isArray(historyList) ? historyList : []) {
    const role = msg?.role || "user";
    const content = Array.isArray(msg?.content) ? msg.content : [];

    const texts = content
      .filter(isTextItem)
      .map((x) => x.text.trim())
      .filter(Boolean);

    if (texts.length) {
      lines.push(`${roleLabel(role)}: ${texts.join("\n")}`);
    }
  }

  return lines.join("\n\n").trim();
}

function pickImagesFromHistory(historyList, { preferLastUser = true, max = 4 } = {}) {
  const list = Array.isArray(historyList) ? historyList : [];
  const lastUser = [...list].reverse().find((m) => m?.role === "user");

  const sourceMsgs = preferLastUser && lastUser ? [lastUser] : list;

  const items = [];
  for (const m of sourceMsgs) {
    const content = Array.isArray(m?.content) ? m.content : [];
    for (const it of content) {
      if (isImageItem(it) || isLocalFileItem(it)) items.push(it);
      if (items.length >= max) return items;
    }
  }
  return items;
}

async function toOpenAIFileFromImageItem(it) {
  const mod = await import("openai");
  const toFile = mod.toFile;

  // 1) input_image แบบ url
  const url = it?.image_url?.url;
  if (typeof url === "string" && url.trim()) {
    const u = url.trim();

    // data: URL (base64)
    if (u.startsWith("data:image/")) {
      const match = u.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) throw new Error("Invalid data:image base64 format");
      const mimeType = match[1];
      const b64 = match[2];
      const buf = Buffer.from(b64, "base64");
      const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
      return await toFile(buf, `input.${ext}`, { type: mimeType });
    }

    // remote URL (ต้องรันบน node ที่มี fetch และออกเน็ตได้)
    const res = await fetch(u);
    if (!res.ok) throw new Error(`Failed to fetch image url: ${u} (${res.status})`);
    const ab = await res.arrayBuffer();
    const mimeType = res.headers.get("content-type") || "image/png";
    const buf = Buffer.from(ab);
    const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
    return await toFile(buf, `input.${ext}`, { type: mimeType });
  }

  // 2) input_image แบบ base64 แยก field
  if (typeof it?.image_base64 === "string" && it.image_base64.trim()) {
    const mimeType = it?.mimeType || "image/png";
    const buf = Buffer.from(it.image_base64.trim(), "base64");
    const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
    return await toFile(buf, `input.${ext}`, { type: mimeType });
  }

  // 3) input_file แบบ local path
  if (isLocalFileItem(it)) {
    const fp = it.path || it.filePath || it.file_path || it.localPath;
    const mimeType = it.mimeType || "image/png";
    if (!fs.existsSync(fp)) throw new Error(`Input image not found: ${fp}`);
    return await toFile(fs.createReadStream(fp), null, { type: mimeType });
  }

  throw new Error("Unsupported image item format in historyList");
}

/**
 * ✅ ใช้แค่ historyList (รูปแบบ role + content[{type,input_text/output_text/input_image/input_file...}])
 */
exports.openaiGenerateImage = async (
  historyList,
  {
    model = "gpt-image-1",
    outDir = "./uploads",
    fileBase = "gpt-image",
    aspectRatio = "1:1",
    size, // optional "1024x1024" | "1536x1024" | "1024x1536" | "auto"
    n = 1,
    quality = "auto",
    outputFormat = "png", // png | jpeg | webp
    outputCompression = 100,
    background = "auto",
    moderation = "auto",
    user,
    // image picking
    maxInputImages = 4,
    preferLastUserImages = true,
  } = {}
) => {
  const client = await getOpenAI();
  fs.mkdirSync(outDir, { recursive: true });

  const prompt = buildPromptFromHistory(historyList);
  if (!prompt) throw new Error("Prompt is empty (historyList has no text).");

  const finalSize = normalizeSize({ size, aspectRatio });

  // ถ้ามีรูปแนบใน historyList (โดยเฉพาะ message ล่าสุดของ user) → ใช้ edit
  const imageItems = pickImagesFromHistory(historyList, {
    preferLastUser: preferLastUserImages,
    max: maxInputImages,
  });

  let resp;

  if (!imageItems.length) {
    resp = await client.images.generate({
      model,
      prompt,
      n: Math.max(1, Math.min(10, Number(n) || 1)),
      size: finalSize,
      quality,
      output_format: outputFormat,
      output_compression: outputCompression,
      background,
      moderation,
      user,
    });
  } else {
    const images = [];
    for (const it of imageItems) {
      images.push(await toOpenAIFileFromImageItem(it));
    }

    resp = await client.images.edit({
      model,
      image: images,
      prompt,
      n: Math.max(1, Math.min(10, Number(n) || 1)),
      size: finalSize,
      quality,
      output_format: outputFormat,
      output_compression: outputCompression,
      background,
      moderation,
      user,
    });
  }

  const data = resp?.data || [];
  const b64List = data.map((d) => d?.b64_json).filter(Boolean);
  if (!b64List.length) throw new Error("No image returned (b64_json not found).");

  const ext = extFromOutputFormat(outputFormat);
  const saved = b64List.map((b64, idx) => {
    const outPath = path.join(outDir, `${fileBase}-${idx + 1}.${ext}`);
    fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
    return outPath;
  });

  return { files: saved, prompt, response: resp };
};
