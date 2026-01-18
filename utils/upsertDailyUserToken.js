const moment = require("moment-timezone");
const db = require("../db/models");
const { User_token } = db;

const toNumber = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

// ✅ รองรับ 2 รูปแบบ
// 1) response.usageMetadata.*
// 2) response.usage.{ input_tokens, output_tokens, total_tokens }
function extractTokenDelta(response) {
  const usage = response?.usage;
  if (
    usage &&
    (usage.input_tokens != null || usage.output_tokens != null || usage.total_tokens != null)
  ) {
    const inputDelta = toNumber(usage.input_tokens, 0);
    const outputDelta = toNumber(usage.output_tokens, 0);
    const totalDelta = toNumber(usage.total_tokens, inputDelta + outputDelta);
    return { inputDelta, outputDelta, totalDelta };
  }

  const um = response?.usageMetadata;
  const inputDelta = toNumber(um?.promptTokenCount, 0);
  const outputDelta = toNumber(
    (um?.candidatesTokenCount ?? 0) +
      (um?.thoughtsTokenCount ?? 0) +
      (um?.toolUsePromptTokenCount ?? 0),
    0
  );
  const totalDelta = toNumber(um?.totalTokenCount, inputDelta + outputDelta);

  return { inputDelta, outputDelta, totalDelta };
}

async function upsertDailyUserToken({ userId, aiId, response }) {
  // ✅ วันที่ของวันนี้ตาม Asia/Bangkok (เก็บเป็น DATEONLY ได้เลย)
  const usedDate = moment.tz("Asia/Bangkok").format("YYYY-MM-DD");
  const { inputDelta, outputDelta, totalDelta } = extractTokenDelta(response);

  return await db.sequelize.transaction(async (t) => {
    // ไม่มีของวันนี้ -> create
    const row = await User_token.create(
      {
        used_date: usedDate,
        input_token: inputDelta,
        output_token: outputDelta,
        total_token: totalDelta,
        user_id: userId,
        ai_id: aiId,
      },
      { transaction: t }
    );

    return row;
  });
}

module.exports = { upsertDailyUserToken };
