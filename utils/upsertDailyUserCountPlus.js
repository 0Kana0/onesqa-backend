const moment = require("moment-timezone");
const { Op } = require("sequelize");
const db = require("../db/models");
const { User_count, sequelize } = db;

const TZ = "Asia/Bangkok";

async function upsertDailyUserCountPlus() {
  const today = moment.tz(TZ).startOf("day");
  const todayStr = today.format("YYYY-MM-DD");

  return await sequelize.transaction(async (t) => {
    // 1) หาแถวล่าสุด (อิง count_date)
    const lastRow = await User_count.findOne({
      order: [["count_date", "DESC"]],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    const lastDate = lastRow?.count_date
      ? moment.tz(String(lastRow.count_date), TZ).startOf("day")
      : null;

    const carry = lastRow ? Number(lastRow.total_user) || 0 : 0;

    // กันข้อมูลเพี้ยน: lastDate อยู่อนาคต
    if (lastDate && lastDate.isAfter(today, "day")) {
      console.log("⚠️ user_count last count_date is in the future — skip");
      return { count_date: todayStr, backfilled: 0 };
    }

    // 2) backfill วันที่ขาด: จากวันถัดจาก lastDate -> เมื่อวาน
    let backfilled = 0;
    if (lastDate && lastDate.isBefore(today, "day")) {
      const rows = [];
      for (
        let d = lastDate.clone().add(1, "day");
        d.isBefore(today, "day");
        d.add(1, "day")
      ) {
        rows.push({
          count_date: d.format("YYYY-MM-DD"),
          total_user: carry,
        });
      }

      if (rows.length) {
        // ภายใน transaction เดียวกัน เพื่อกันแข่งกัน
        await User_count.bulkCreate(rows, {
          transaction: t,
          ignoreDuplicates: true, // รองรับดีบน Postgres/MySQL/SQLite
        });
        backfilled = rows.length;
      }
    }

    // 3) วันนี้: ถ้าไม่มี -> create, ถ้ามี -> increment +1
    const rowToday = await User_count.findOne({
      where: { count_date: todayStr },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!rowToday) {
      const created = await User_count.create(
        { count_date: todayStr, total_user: 1 },
        { transaction: t }
      );
      console.log(`📊 Created user_count today (${todayStr}) total_user=1`);
      if (backfilled) {
        console.log(`📊 Backfilled user_count ${backfilled} day(s) using carry=${carry}`);
      }
      return { row: created, backfilled };
    }

    await rowToday.increment({ total_user: 1 }, { transaction: t });
    console.log(`📊 Increment user_count today (${todayStr}) +1`);
    if (backfilled) {
      console.log(`📊 Backfilled user_count ${backfilled} day(s) using carry=${carry}`);
    }
    return { row: rowToday, backfilled };
  });
}

module.exports = { upsertDailyUserCountPlus };
