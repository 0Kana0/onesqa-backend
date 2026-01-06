// config/email-config.js
const nodemailer = require("nodemailer");

const port = Number(process.env.EMAIL_PORT || 465);

// ✅ ถ้าไม่ได้กำหนด EMAIL_SECURE มา ให้เดาตาม port
// - 465 = secure true
// - 587/25 = secure false (STARTTLS)
const secure =
  process.env.EMAIL_SECURE !== undefined
    ? String(process.env.EMAIL_SECURE).toLowerCase() === "true"
    : port === 465;

const transporter = nodemailer.createTransport({
  // ✅ เปิด pooling เพื่อส่งจำนวนมากได้ดีขึ้น (ลด login/connect ถี่ ๆ)
  pool: true,

  // ✅ ปรับตามกำลัง SMTP ของคุณ (ตั้งผ่าน env ได้)
  maxConnections: Number(process.env.EMAIL_MAX_CONNECTIONS || 10),
  maxMessages: Number(process.env.EMAIL_MAX_MESSAGES || 200),

  host: process.env.EMAIL_HOST,
  port,
  secure,

  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD, // (แนะนำตั้งชื่อเป็น EMAIL_PASS ก็ได้ แต่ยึดของคุณ)
  },

  // (optional) กัน connection ค้าง/ช้า
  connectionTimeout: Number(process.env.EMAIL_CONNECTION_TIMEOUT || 10000),
  greetingTimeout: Number(process.env.EMAIL_GREETING_TIMEOUT || 10000),
  socketTimeout: Number(process.env.EMAIL_SOCKET_TIMEOUT || 30000),

  // (optional) ถ้าใช้ 587 จะใช้ STARTTLS โดยปกติอยู่แล้ว
  // tls: { rejectUnauthorized: false }, // ใช้เฉพาะกรณี cert ภายในหน่วยงานมีปัญหา
});

module.exports = transporter;