const moment = require("moment-timezone");
const { Op } = require("sequelize");
const db = require("../db/models");
const { User_count } = db;

async function upsertMonthlyUserCountPlus() {
  const nowBkk = moment.tz("Asia/Bangkok");
  const startUTC = nowBkk.clone().startOf("month").utc().toDate();
  const nextUTC  = nowBkk.clone().add(1, "month").startOf("month").utc().toDate();

  // ถ้า field ใน Sequelize คือ createdAt (แม้ column จริงจะเป็น created_at)
  const whereThisMonth = {
    createdAt: { [Op.gte]: startUTC, [Op.lt]: nextUTC },
  };

  // ✅ ถ้าไม่มีแถวของเดือนนี้ -> create, ถ้ามี -> increment
  return await db.sequelize.transaction(async (t) => {
    const row = await User_count.findOne({
      where: whereThisMonth,
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!row) {
      return await User_count.create(
        { total_user: 1 }, // createdAt จะเป็นตอน create (อยู่เดือนนี้แน่นอน)
        { transaction: t }
      );
    }

    await row.increment({ total_user: 1 }, { transaction: t });
    return row;
  });
}

module.exports = { upsertMonthlyUserCountPlus };
