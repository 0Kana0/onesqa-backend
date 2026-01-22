// utils/updateTokenAndNotify.js
const { Op } = require("sequelize");
const db = require("../db/models");
const { Ai, User_ai, User, User_role } = db;
const { calcPercent } = require("./checkTokenQuota");
const { notifyUser } = require("./notifier");
const { getLocale } = require("../utils/currentUser");

// helper: format ตัวเลขให้อ่านง่าย
function fmt(n, locale = "en-US") {
  const num = Number(n) || 0;
  return num.toLocaleString(locale);
}

/**
 * อัปเดต token (Ai + User_ai) แล้วเช็ค % / จำนวนคงเหลือ เพื่อส่งแจ้งเตือน
 */
async function updateTokenAndNotify({
  ctx,
  chatOne,
  usedTokens,
  thresholdPercent = 15,
  thresholdTokenCount = 1_000_000, // ✅ เพิ่ม threshold แบบจำนวน token คงเหลือ
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
  const aiUpdateOptions = { where: { id: aiId } };
  const userAiUpdateOptions = { where: { ai_id: aiId, user_id: userId } };
  if (transaction) {
    aiUpdateOptions.transaction = transaction;
    userAiUpdateOptions.transaction = transaction;
  }

  await Ai.update(
    { token_count: Ai.sequelize.literal(`token_count - ${used}`) },
    aiUpdateOptions
  );

  await User_ai.update(
    { token_count: User_ai.sequelize.literal(`token_count - ${used}`) },
    userAiUpdateOptions
  );

  // -------------------------
  // 2) โหลดค่าปัจจุบันหลังอัปเดต
  // -------------------------
  const findAiOptions = { attributes: ["token_count", "token_all", "is_notification"] };
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
  // 3) คำนวณเปอร์เซ็นต์คงเหลือ
  // -------------------------
  const percentAi = calcPercent(updatedAi.token_count, updatedAi.token_all);
  const percentUserAi = calcPercent(updatedUserAi.token_count, updatedUserAi.token_all);

  // -------------------------
  // ✅ 3.1) เงื่อนไขแจ้งเตือนแบบ “เปอร์เซ็นต์” หรือ “จำนวน token คงเหลือ”
  // -------------------------
  const aiRemain = Number(updatedAi.token_count) || 0;
  const userRemain = Number(updatedUserAi.token_count) || 0;

  const shouldNotifyAi =
    (percentAi < thresholdPercent) || (aiRemain < thresholdTokenCount);

  const shouldNotifyUserAi =
    (percentUserAi < thresholdPercent) || (userRemain < thresholdTokenCount);

  // -------------------------
  // 4) token ของทั้งระบบ: ส่งแจ้งเตือนให้ผู้ดูแลทั้งหมด (role_id = 3/4)
  // -------------------------
  if (shouldNotifyAi && updatedAi?.is_notification === false) {
    const adminFindOptions = {
      attributes: ["id", "email", "locale", "loginAt"],
      include: [
        {
          model: User_role,
          as: "user_role",
          where: { role_id: { [Op.in]: [3, 4] } },
          attributes: [],
        },
      ],
    };
    if (transaction) adminFindOptions.transaction = transaction;

    const adminUsers = await User.findAll(adminFindOptions);

    // สร้างเหตุผลเพื่อใส่ในข้อความ (จะได้รู้ว่าเตือนเพราะอะไร)
    const reasonTH =
      aiRemain < thresholdTokenCount
        ? `คงเหลือ ${fmt(aiRemain, "th-TH")} token (ต่ำกว่า ${fmt(thresholdTokenCount, "th-TH")})`
        : `คงเหลือ ${percentAi}% (ต่ำกว่า ${thresholdPercent}%)`;

    const reasonEN =
      aiRemain < thresholdTokenCount
        ? `Remaining ${fmt(aiRemain, "en-US")} tokens (below ${fmt(thresholdTokenCount, "en-US")})`
        : `Remaining ${percentAi}% (below ${thresholdPercent}%)`;

    for (const admin of adminUsers) {
      // ภาษาไทย
      await notifyUser({
        locale: "th",
        recipient_locale: admin.locale,
        loginAt: admin.loginAt,
        userId: admin.id,
        title: "การใช้งาน Token ใกล้ถึงขีดจำกัดของระบบ",
        message: `Token ของ Model ${chatOne?.ai?.model_use_name} ${reasonTH} กรุณาติดตามการใช้งานอย่างใกล้ชิด`,
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
        title: "System Token Usage Warning",
        message: `Model ${chatOne?.ai?.model_use_name}: ${reasonEN}. Please monitor usage closely.`,
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
