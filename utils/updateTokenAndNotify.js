// utils/updateTokenAndNotify.js
const { Op } = require("sequelize");
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Ai, User_ai, User, User_role } = db;
const { calcPercent } = require("./checkTokenQuota"); 
const { notifyUser } = require("./notifier"); // ที่ไฟล์ service/controller ของคุณ
const { getLocale, getCurrentUser } = require("../utils/currentUser");

// ↑ ถ้า util calcPercent อยู่ไฟล์อื่น / ชื่ออื่น ปรับ path ตามจริง

/**
 * อัปเดต token (Ai + User_ai) แล้วเช็ค % เพื่อส่งแจ้งเตือน
 *
 * @param {Object} params
 * @param {Object} params.chatOne        - object แชทเดิม (ต้องมี ai.id, ai.model_use_name, user_id, user.email)
 * @param {number} params.usedTokens     - จำนวน token ที่ใช้ไปในการตอบครั้งนี้
 * @param {number} [params.thresholdPercent=15] - % เหลือน้อยกว่าค่านี้ให้แจ้งเตือน
 * @param {Object} [params.transaction]  - Sequelize transaction (optional)
 *
 * @returns {Promise<{ percentAi: number, percentUserAi: number }>}
 */
async function updateTokenAndNotify({
  ctx,
  chatOne,
  usedTokens,
  thresholdPercent = 15,
  transaction,
}) {

  const locale = await getLocale(ctx);

  if (!chatOne?.ai?.id || !chatOne?.user_id) {
    throw new Error(
      locale === "th"
        ? "chatOne ไม่ครบ ai.id หรือ user_id"
        : "chatOne is missing ai.id or user_id"
    );
  }

  const aiId = chatOne.ai.id;
  const userId = chatOne.user_id;
  const used = Number(usedTokens) || 0;

  // -------------------------
  // 1) อัปเดต token_count (หักออก)
  // -------------------------
  const aiUpdateOptions = {
    where: { id: aiId },
  };
  const userAiUpdateOptions = {
    where: { ai_id: aiId, user_id: userId },
  };
  if (transaction) {
    aiUpdateOptions.transaction = transaction;
    userAiUpdateOptions.transaction = transaction;
  }

  await Ai.update(
    {
      token_count: Ai.sequelize.literal(`token_count - ${used}`),
    },
    aiUpdateOptions
  );

  await User_ai.update(
    {
      token_count: User_ai.sequelize.literal(`token_count - ${used}`),
    },
    userAiUpdateOptions
  );

  // -------------------------
  // 2) โหลดค่าปัจจุบันหลังอัปเดต
  // -------------------------
  const findAiOptions = {
    attributes: ["token_count", "token_all", "is_notification"],
  };
  if (transaction) findAiOptions.transaction = transaction;

  const updatedAi = await Ai.findByPk(aiId, findAiOptions);

  const findUserAiOptions = {
    where: { ai_id: aiId, user_id: userId },
    attributes: ["token_count", "token_all", "is_notification"],
  };
  if (transaction) findUserAiOptions.transaction = transaction;

  const updatedUserAi = await User_ai.findOne(findUserAiOptions);

  if (!updatedAi || !updatedUserAi) {
    throw new Error(
      locale === "th"
        ? "ไม่พบข้อมูล token หลังอัปเดต"
        : "Token data not found after update"
    );
  }

  // -------------------------
  // 3) คำนวณเปอร์เซ็นต์แบบกัน NaN (ใช้ calcPercent จาก util เดิม)
  // -------------------------
  const percentAi = calcPercent(updatedAi.token_count, updatedAi.token_all);
  const percentUserAi = calcPercent(
    updatedUserAi.token_count,
    updatedUserAi.token_all
  );

  console.log("percentAi", percentAi);
  console.log("percentUserAi", percentUserAi);

  // -------------------------
  // 4) token ของทั้งระบบ: ส่งแจ้งเตือนให้ผู้ดูแลทั้งหมด (role_id = 3)
  // -------------------------
  if (percentAi < thresholdPercent && updatedAi?.is_notification === false) {
    const adminFindOptions = {
      attributes: ["id", "email", "locale", "loginAt"],
      include: [
        {
          model: User_role,
          as: "user_role",
          where: { 
            role_id: { [Op.in]: [3, 4] }   // role_id = 3 หรือ 4
          },
          attributes: [],
        },
      ],
    };
    if (transaction) adminFindOptions.transaction = transaction;

    const adminUsers = await User.findAll(adminFindOptions);

    for (const admin of adminUsers) {
      // ภาษาไทย
      await notifyUser({
        locale: "th",
        recipient_locale: admin.locale,
        loginAt: admin.loginAt,
        userId: admin.id,
        title: "การใช้งาน Token เกินกำหนดของระบบ",
        message: `การใช้งาน Token ของ Model ${chatOne?.ai?.model_use_name} อยู่ที่ 85% กรุณาติดตามการใช้งานอย่างใกล้ชิด`,
        type: "WARNING",
        to: admin.email,
        transaction,
      });

      // ภาษาอังกฤษ
      await notifyUser({
        locale: "en",
        recipient_locale: admin.locale,
        loginAt: admin.loginAt,
        userId: admin.id,
        title: "System Token Usage Limit Warning",
        message: `Token usage for model ${chatOne?.ai?.model_use_name} has reached 85%. Please monitor usage closely.`,
        type: "WARNING",
        to: admin.email,
        transaction,
      });
    }

    const aiNotifUpdateOptions = { where: { id: aiId } };
    if (transaction) aiNotifUpdateOptions.transaction = transaction;

    await Ai.update(
      {
        is_notification: true,
      },
      aiNotifUpdateOptions
    );
  }

  // -------------------------
  // 5) token ของ user: ส่งแจ้งเตือนให้ user คนนั้น
  // -------------------------
  if (
    percentUserAi < thresholdPercent &&
    updatedUserAi?.is_notification === false
  ) {
    // ภาษาไทย
    await notifyUser({
      locale: "th",
      recipient_locale: chatOne?.user?.locale,
      loginAt: chatOne?.user?.loginAt,
      userId,
      title: "การใช้งาน Token เกินกำหนด",
      message: `การใช้งาน Token ของ Model ${chatOne?.ai?.model_use_name} อยู่ที่ 85% กรุณาติดต่อผู้ดูแลระบบ`,
      type: "WARNING",
      to: chatOne?.user?.email,
      transaction,
    });

    // ภาษาอังกฤษ
    await notifyUser({
      locale: "en",
      recipient_locale: chatOne?.user?.locale,
      loginAt: chatOne?.user?.loginAt,
      userId,
      title: "Token Usage Limit Warning",
      message: `Token usage for model ${chatOne?.ai?.model_use_name} has reached 85%. Please contact the system administrator.`,
      type: "WARNING",
      to: chatOne?.user?.email,
      transaction,
    });

    const userAiNotifUpdateOptions = {
      where: { ai_id: aiId, user_id: userId },
    };
    if (transaction) userAiNotifUpdateOptions.transaction = transaction;

    await User_ai.update(
      {
        is_notification: true,
      },
      userAiNotifUpdateOptions
    );
  }

  // return ค่าไว้ใช้ debug / ใช้ต่อ
  return { percentAi, percentUserAi };
}

module.exports = {
  updateTokenAndNotify,
};
