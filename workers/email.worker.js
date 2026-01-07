// workers/email.worker.js
require("dotenv").config();
const { Worker } = require("bullmq");
const connection = require("../function/redis-queue");
const transporter = require("../config/email-config.js");

const CONCURRENCY = Number(process.env.EMAIL_WORKER_CONCURRENCY || 10);

// ✅ คุมอัตราการส่ง (แนะนำใส่เสมอ)
// ตัวอย่าง: 50 emails ต่อ 1 วินาที
const RATE_MAX = Number(process.env.EMAIL_RATE_MAX || 50);
const RATE_DURATION = Number(process.env.EMAIL_RATE_DURATION || 1000);

// ✅ ถ้าโดน throttle ให้พัก worker ชั่วคราว
const THROTTLE_PAUSE_MS = Number(process.env.EMAIL_THROTTLE_PAUSE_MS || 5 * 60 * 1000);

let isCoolingDown = false;

console.log("📨 Email Worker starting...");
console.log("🔌 Redis URL:", process.env.REDIS_URL ? "✅ set" : "❌ missing");
console.log("📮 SMTP:", process.env.EMAIL_HOST ? "✅ set" : "❌ missing");
console.log("⚙️ Concurrency:", CONCURRENCY);
console.log("⏱️ RateLimit:", `${RATE_MAX}/${RATE_DURATION}ms`);

const worker = new Worker(
  "email-queue",
  async (job) => {
    const { to, subject, text, html } = job.data;

    console.log(
      `📥 [EMAIL][START] jobId=${job.id} to=${to} subject=${subject} attemptsMade=${job.attemptsMade}`
    );

    // ส่งจริง + เก็บ response ไว้ log
    const info = await transporter.sendMail({
      from: `<${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
      html,
    });

    console.log(
      `✅ [EMAIL][SENT] jobId=${job.id} to=${to} subject=${subject} messageId=${info?.messageId || "-"}`
    );

    return { ok: true, to, subject, messageId: info?.messageId, response: info?.response };
  },
  {
    connection,
    concurrency: CONCURRENCY,
    limiter: { max: RATE_MAX, duration: RATE_DURATION }, // ✅ BullMQ rate limiting :contentReference[oaicite:3]{index=3}
  }
);

worker.on("completed", (job, result) => {
  console.log(
    `🎉 [EMAIL][DONE] jobId=${job.id} to=${result?.to || job.data?.to} subject=${result?.subject || job.data?.subject} messageId=${result?.messageId || "-"}`
  );
});

worker.on("failed", async (job, err) => {
  const msg = err?.message || "";
  console.error(
    `❌ [EMAIL][FAIL] jobId=${job?.id} to=${job?.data?.to} subject=${job?.data?.subject} attemptsMade=${job?.attemptsMade} error=${msg}`
  );

  // ✅ Circuit breaker: ถ้าเจออาการ throttle แบบ Gmail/SMTP
  const isThrottle =
    /Too many login attempts|4\.7\.0|rate limit|throttl|temporarily unavailable/i.test(msg);

  if (isThrottle && !isCoolingDown) {
    isCoolingDown = true;
    console.error(`🧊 [EMAIL][COOLDOWN] Pausing worker for ${THROTTLE_PAUSE_MS}ms...`);
    try {
      await worker.pause(true); // pause ทันที :contentReference[oaicite:4]{index=4}
      setTimeout(async () => {
        try {
          await worker.resume();
          console.log("▶️ [EMAIL][COOLDOWN] Worker resumed");
        } finally {
          isCoolingDown = false;
        }
      }, THROTTLE_PAUSE_MS);
    } catch (e) {
      isCoolingDown = false;
    }
  }
});

worker.on("error", (err) => {
  console.error("🔥 [EMAIL][WORKER_ERROR]", err);
});
