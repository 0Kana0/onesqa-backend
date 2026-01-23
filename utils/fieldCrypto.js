// utils/fieldCrypto.js
const crypto = require("crypto");

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // recommended for GCM

function getKey() {
  const b64 = process.env.FIELD_ENC_KEY;
  if (!b64) throw new Error("Missing FIELD_ENC_KEY in env");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("FIELD_ENC_KEY must be 32 bytes (base64)");
  return key;
}

function encryptText(plain) {
  if (plain === null || plain === undefined) return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);

  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // payload = base64( iv(12) + tag(16) + ciphertext )
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

function decryptText(payload) {
  if (!payload) return payload;

  const key = getKey();
  const buf = Buffer.from(String(payload), "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const ct = buf.subarray(IV_LEN + 16);

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

// ใช้ทำ lookup/unique โดยไม่ต้องถอดรหัส (แนะนำสำหรับ email/phone)
function lookupHash(value) {
  if (value === null || value === undefined) return null;
  const v = String(value).trim().toLowerCase();
  const pepper = process.env.LOOKUP_HASH_KEY || "default-pepper-change-me";
  return crypto.createHmac("sha256", pepper).update(v).digest("hex");
}

module.exports = { encryptText, decryptText, lookupHash };
