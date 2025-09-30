// services/otpService.js
const redisClient = require('../function/redis');

const OTP_PREFIX = 'otp:';
const OTP_TTL_SECONDS = 60 * 5; // 5 นาที

function buildKey(idennumber) {
  return `${OTP_PREFIX}${idennumber}`;
}

async function setOtp(idennumber, otp) {
  const key = buildKey(idennumber);
  await redisClient.setEx(key, OTP_TTL_SECONDS, otp);
}

async function getOtp(idennumber) {
  const key = buildKey(idennumber);
  return await redisClient.get(key);
}

async function deleteOtp(idennumber) {
  const key = buildKey(idennumber);
  await redisClient.del(key);
}

async function verifyOtp(idennumber, inputOtp) {
  const storedOtp = await getOtp(idennumber);
  if (!storedOtp) return false;
  const isValid = storedOtp === inputOtp;
  if (isValid) await deleteOtp(idennumber); // ใช้แล้วลบทิ้ง
  return isValid;
}

module.exports = {
  setOtp,
  getOtp,
  deleteOtp,
  verifyOtp,
};
