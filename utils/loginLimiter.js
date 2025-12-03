// loginLimiter.js
const redis = require("../function/redis");

const MAX_FAILED_ATTEMPTS = 5;        // ใส่ผิดได้สูงสุด 5 ครั้ง
const LOCK_TIME_SECONDS = 5 * 60;     // ล็อก 5 นาที

const loginFailKey = (username) => `login:fail:${username}`;
const loginLockKey = (username) => `login:lock:${username}`;

// เช็กว่าบัญชีนี้ถูกล็อกอยู่ไหม
async function checkUserLocked(username) {
  const lockKey = loginLockKey(username);
  const isLocked = await redis.exists(lockKey); // 1 = locked, 0 = not
  if (!isLocked) return null;

  const ttl = await redis.ttl(lockKey); // เหลือกี่วินาที
  return ttl; // ถ้า null แปลว่าล็อกแต่ไม่มี TTL (ปกติจะมี)
}

// จัดการตอนใส่รหัสผิด
async function handleFailedLogin(username, descMessage) {
  const failKey = loginFailKey(username);
  const lockKey = loginLockKey(username);

  // เพิ่มตัวนับ (atomic ใน Redis)
  const fails = await redis.incr(failKey);

  if (fails === 1) {
    // นับครั้งแรก ตั้ง TTL ให้ตัวนับ เพื่อไม่ให้ค้างตลอดไป
    await redis.expire(failKey, LOCK_TIME_SECONDS);
  }
  const baseMessage = descMessage || "เข้าสู่ระบบไม่สำเร็จ";

  // ❌ ถ้าครบ/เกิน MAX_FAILED_ATTEMPTS → ล็อกบัญชี
  if (fails >= MAX_FAILED_ATTEMPTS) {
    await redis.set(lockKey, "1", { EX: LOCK_TIME_SECONDS });

    // ใส่จำนวนครั้งลงใน message ด้วย
    throw new Error(
      `บัญชีนี้ถูกล็อกชั่วคราว กรุณารอสักครู่เพื่อเข้าสู่ระบบอีกครั้ง 05:00 นาที`
    );
  }

  // ❌ ยังไม่ถึง limit → เอา message เดิม + จำนวนครั้ง
  throw new Error(
    `${baseMessage} (ครั้งที่ ${fails}/${MAX_FAILED_ATTEMPTS})`
  );
}

// ล้างสถานะเมื่อ login สำเร็จ
async function resetLoginState(username) {
  await redis.del(loginFailKey(username));
  await redis.del(loginLockKey(username));
}

module.exports = {
  checkUserLocked,
  resetLoginState,
  handleFailedLogin,
  MAX_FAILED_ATTEMPTS,
  LOCK_TIME_SECONDS,
};
