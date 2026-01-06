// services/email.service.js
const emailQueue = require('../queues/email.queue');

async function enqueueEmail({ to, subject, text, html, meta }) {
  // จะ await หรือไม่ await ก็ได้
  // - await = มั่นใจว่าเข้าคิวแน่ (แนะนำ)
  // - ไม่ await = เร็วสุด แต่ถ้า redis ล่มจะไม่รู้
  return emailQueue.add(
    "send-email",
    { to, subject, text, html, meta },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );
}

module.exports = { enqueueEmail };
