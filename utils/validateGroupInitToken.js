const { Op } = require("sequelize");
const db = require("../db/models");
const { User, RefreshToken, User_role, User_ai, Role, Ai, Group, Group_ai } = db;

/**
 * ตรวจ init_token ของ group_ai (ตาม group_name) ว่าเกิน token_count ของ ai ใน ai_exists หรือไม่
 * ถ้าเกิน -> throw Error
 *
 * @param {Object} params
 * @param {string} params.groupName
 * @param {Array<{id:number|string, token_count:number}>} params.aiExists
 * @param {any} params.Group       Sequelize Model
 * @param {any} params.Group_ai    Sequelize Model
 */
async function validateGroupInitTokenNotExceedAiTokenCount({
  groupName,
  aiExists,
}) {
  const group = await Group.findOne({ where: { name: groupName } });
  if (!group) throw new Error(`Group not found: ${groupName}`);

  const groupAis = await Group_ai.findAll({ where: { group_id: group.id } });

  // map ai_id -> token_count (จาก aiExists)
  const aiTokenCountById = new Map(
    (aiExists || []).map((ai) => [Number(ai.id), Number(ai.token_count ?? 0)])
  );

  const violations = [];

  for (const ga of groupAis) {
    const aiId = Number(ga.ai_id);
    const initToken = Number(ga.init_token ?? 0);

    // ถ้า aiExists ไม่มี ai นี้ -> ถือว่าเท่ากับ 0 (จะทำให้ initToken > 0 โดน throw)
    const tokenCount = aiTokenCountById.has(aiId) ? aiTokenCountById.get(aiId) : 0;

    const allUseToken = await User_ai.sum("token_count", {
      where: {
        ai_id: aiId,
        token_count: { [Op.ne]: 0 },
      },
    });
    console.log("allUseToken", allUseToken);

    if (allUseToken + initToken > tokenCount) {
      violations.push({ ai_id: aiId, init_token: initToken, token_count: tokenCount });
    }
  }

  if (violations.length) {
    throw new Error(
      `จำนวน Token มีไม่เพียงพอสำหรับการเข้าสู่ระบบ`
    );
  }

  return true;
}

module.exports = { validateGroupInitTokenNotExceedAiTokenCount };
