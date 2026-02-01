// utils/rag/ragService.js
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EMBED_MODEL = "text-embedding-3-small";

// chunk แบบง่าย (char-based) กันยาวเกิน
function normalizeForEmbed(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")   // ยุบเฉพาะ space/tab
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLongLine(line, maxChars) {
  const s = String(line || "");
  if (s.length <= maxChars) return [s];

  // พยายามแตกตามตัวคั่นคอลัมน์ก่อน
  const parts = s.split(" | ");
  const out = [];
  let buf = "";

  for (const p of parts) {
    const add = (buf ? " | " : "") + p;
    if ((buf + add).length > maxChars) {
      if (buf) out.push(buf);
      // ถ้า p เองยังยาวเกิน ก็หั่นตามตัวอักษร
      if (p.length > maxChars) {
        for (let i = 0; i < p.length; i += maxChars) {
          out.push(p.slice(i, i + maxChars));
        }
        buf = "";
      } else {
        buf = p;
      }
    } else {
      buf += add;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function chunkText(text, { maxChars = 1800, overlapLines = 6 } = {}) {
  const t = normalizeForEmbed(text);
  if (!t) return [];

  const lines = t.split("\n");
  const chunks = [];

  let buf = [];
  let len = 0;

  for (const line of lines) {
    // ✅ แตก “บรรทัดที่ยาวเกิน” ก่อน
    const subLines = splitLongLine(line, maxChars);

    for (const sub of subLines) {
      const l = sub + "\n";

      if (len + l.length > maxChars && buf.length) {
        chunks.push(buf.join("").trim());

        const keep = buf.slice(Math.max(0, buf.length - overlapLines));
        buf = [...keep];
        len = buf.join("").length;
      }

      buf.push(l);
      len += l.length;
    }
  }

  if (buf.length) chunks.push(buf.join("").trim());
  return chunks.filter(Boolean);
}

// cosine similarity
function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

async function embedTexts(texts, { batchSize = 96 } = {}) {
  const inputAll = texts.map(t => String(t || "").trim()).filter(Boolean);
  if (!inputAll.length) return [];

  const vectors = [];
  for (let i = 0; i < inputAll.length; i += batchSize) {
    const input = inputAll.slice(i, i + batchSize);
    const resp = await client.embeddings.create({
      model: EMBED_MODEL,
      input,
    });
    vectors.push(...resp.data.map(d => d.embedding));
  }
  return vectors;
}

/**
 * Index ไฟล์ 1 ไฟล์ ลง DB (ถ้ายังไม่เคย index)
 * @param {{ db:any, chatId:number|string, file:any, extractors:any, transcribeAudio:Function }} args
 */
async function ensureIndexedFile({ db, chatId, file, extractors, transcribeAudio }) {
  const { Rag_chunk } = db;

  const fileId = file.id;
  const fileName = file.file_name;
  const ext = path.extname(fileName).toLowerCase();

  // เช็คว่ามี chunk อยู่แล้วไหม
  const exists = await Rag_chunk.findOne({
    where: { chat_id: chatId, file_id: fileId },
    attributes: ["id"],
  });
  if (exists) return { indexed: false, count: 0 };

  // อ่าน/แปลงเป็น text
  const filePath = path.join(__dirname, "../../uploads", fileName);

  let text = "";
  if (ext === ".pdf") {
    const out = await extractors.extractTextFromPDF(filePath);
    text = out?.text || "";
  } else if (ext === ".doc" || ext === ".docx") {
    const out = await extractors.extractTextFromWord(filePath);
    text = out?.text || "";
  } else if (ext === ".xls" || ext === ".xlsx") {
    const out = await extractors.extractTextFromExcel(filePath);
    text = out?.text || "";
  } else if (ext === ".ppt" || ext === ".pptx") {
    const out = await extractors.extractTextFromPowerPoint(filePath);
    text = out?.text || "";
  } else if (ext === ".mp4") {
    // mp4 → transcript
    text = await transcribeAudio(filePath);
  } else {
    // ไม่ใช่ไฟล์ที่เราจะ index
    return { indexed: false, count: 0 };
  }

  text = String(text || "").trim();
  if (!text) return { indexed: true, count: 0 };

  // chunk + embed
  text = normalizeForEmbed(text);
  const chunks = chunkText(text, { maxChars: 1800, overlapLines: 6 });
  if (!chunks.length) return { indexed: true, count: 0 };

  const vectors = await embedTexts(chunks);

  // insert
  const rows = chunks.map((c, i) => ({
    chat_id: chatId,
    file_id: fileId,
    file_name: fileName,
    file_ext: ext,
    chunk_index: i,
    content: c,
    embedding_json: JSON.stringify(vectors[i]),
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  await Rag_chunk.bulkCreate(rows);
  return { indexed: true, count: rows.length };
}

/**
 * Ensure index ให้ไฟล์ทั้งหมดที่เกี่ยวข้องใน chat (เฉพาะ ext ที่กำหนด)
 */
async function ensureIndexedFilesForChat({ db, chatId, files, extractors, transcribeAudio }) {
  const results = [];
  for (const f of files) {
    try {
      results.push(await ensureIndexedFile({ db, chatId, file: f, extractors, transcribeAudio }));
    } catch (e) {
      // อย่าทำให้ทั้ง request ล้มเพราะไฟล์เดียว index ไม่ได้
      results.push({ indexed: false, count: 0, error: e?.message });
    }
  }
  return results;
}

/**
 * Retrieve topK chunks สำหรับ query จากไฟล์ที่กำหนด
 */
async function retrieveContext({ db, chatId, fileIds, query, topK = 20, candidateLimit = 20000 }) {
  const { Rag_chunk } = db;
  const q = String(query || "").trim();
  if (!q) return { contextText: "", hits: [] };

  // multi-query เพิ่ม recall (ตัวเลข/format)
  const variants = [...new Set([
    q,
    q.replace(/,/g, ""),                 // 1,000 -> 1000
    q.replace(/[ \t]+/g, " ").trim(),    // normalize spacing
  ])];

  const qVecs = await embedTexts(variants);
  if (!qVecs?.length) return { contextText: "", hits: [] };

  const rows = await Rag_chunk.findAll({
    where: { chat_id: chatId, ...(fileIds?.length ? { file_id: fileIds } : {}) },
    attributes: ["file_name", "chunk_index", "content", "embedding_json"],
    limit: candidateLimit,
  });

  const scored = [];
  for (const r of rows) {
    let emb;
    try { emb = JSON.parse(r.embedding_json); } catch { continue; }

    let best = -1;
    for (const qv of qVecs) best = Math.max(best, cosineSim(qv, emb));

      scored.push({
        file_name: r.file_name,
        chunk_index: r.chunk_index,
        content: r.content,
        score: best,
      });
  }
  scored.sort((a, b) => b.score - a.score);
  const hits = scored.slice(0, topK);

  const contextText = hits.map((h, i) =>
    `[#${i + 1}] (${h.file_name} | chunk ${h.chunk_index})\n${h.content}`
  ).join("\n\n");

  return { contextText, hits };
}

/**
 * ลบ chunk ของไฟล์ที่ถูกลบออก (optional แต่แนะนำสำหรับ updateMessage)
 */
async function deleteRagByFileNames({ db, fileNames }) {
  const { Rag_chunk } = db;
  if (!Array.isArray(fileNames) || !fileNames.length) return 0;
  const count = await Rag_chunk.destroy({ where: { file_name: fileNames } });
  return count;
}

module.exports = {
  ensureIndexedFilesForChat,
  retrieveContext,
  deleteRagByFileNames,
};
