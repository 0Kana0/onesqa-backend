// utils/checkTokenQuota.js
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { User_ai, Ai, User } = db;
const { getLocale, getCurrentUser } = require("../utils/currentUser");

const DEFAULT_MIN_PERCENT = 15;

// helper คำนวณเปอร์เซ็นต์แบบกัน error
function calcPercent(count, total) {
  const c = Number(count ?? 0);
  const t = Number(total ?? 0);

  if (!t || Number.isNaN(c) || Number.isNaN(t)) return 0;

  return Math.min((c / t) * 100, 100);
}

/**
 * ตรวจสอบสิทธิ์ token ทั้งระบบ และราย user
 * ถ้าไม่พอให้ throw Error ทันที
 *
 * @param {Object} params
 * @param {number|string} params.aiId    - chatOne?.ai?.id
 * @param {number|string} params.userId  - chatOne?.user_id
 * @param {number} [params.minPercent=15]
 * @returns {Promise<{ all_percent: number, user_percent: number }>}
 */
async function checkTokenQuota({ aiId, userId, minPercent = DEFAULT_MIN_PERCENT, ctx }) {

  const locale = await getLocale(ctx);

  // ---- เช็คว่า user ได้รับอนุญาติให้ใช้งาน model ใหม ----
  const checkStatusUser = await User.findOne({
    attributes: ["ai_access"],
    where: { id: userId }
  })
  if (checkStatusUser.ai_access === false) {
    throw new Error(
      locale === "th"
        ? "User นี้ถูกปิดการใช้งาน AI"
        : "This user has AI disabled"
    );
  }

  // ---- เช็คว่า token เปิดใช้งานอยู่ใหม ----
  const checkStatusModel = await Ai.findOne({
    attributes: ["activity"],
    where: { id: aiId }
  })
  if (checkStatusModel.activity === false) {
    throw new Error(
      locale === "th"
        ? "Model นี้ปิดการใช้งานอยู่"
        : "This model is disabled"
    );
  }

  // ---- เช็ค token ของ user ----
  const checkUserToken = await User_ai.findOne({
    attributes: ["token_count", "token_all"],
    where: {
      ai_id: aiId,
      user_id: userId,
    },
  });
  if (!checkUserToken) {
    throw new Error(
      locale === "th"
        ? "ไม่พบข้อมูล Token ของผู้ใช้สำหรับ AI นี้"
        : "User token data for this AI was not found"
    );
  }
  const user_percent = calcPercent(
    checkUserToken.token_count,
    checkUserToken.token_all
  );
  console.log("user_percent", user_percent);
  if (user_percent < minPercent) {
    throw new Error(
      locale === "th"
        ? "Token ของผู้ใช้น้อยเกินไป ไม่สามารถแชตได้"
        : "User has insufficient tokens to chat"
    );
  }

  // ถ้าผ่านทั้งสองเงื่อนไข return ค่าไว้เผื่อ debug / ใช้ต่อ
  return { user_percent };
}

module.exports = {
  checkTokenQuota,
  calcPercent,
};
