// controllers/user_count.controller.js
const { Op, fn, col } = require("sequelize");
const db = require("../db/models");
const { User_count } = db;
const moment = require("moment-timezone");

exports.CardUserCountReports = async () => {
  try {
    // 🌏 กำหนด timezone ไทย
    const tz = "Asia/Bangkok";

    // ✅ ตรวจว่ามีฟิลด์ count_date (แบบใหม่) ไหม
    const hasCountDate = !!User_count?.rawAttributes?.count_date;

    let current = null;
    let previous = null;

    if (hasCountDate) {
      // --------------------------
      // ✅ แบบใหม่: รายวัน (count_date)
      // --------------------------
      const startThisMonth = moment.tz(tz).startOf("month").format("YYYY-MM-DD");
      const startNextMonth = moment
        .tz(tz)
        .add(1, "month")
        .startOf("month")
        .format("YYYY-MM-DD");

      const startLastMonth = moment
        .tz(tz)
        .subtract(1, "month")
        .startOf("month")
        .format("YYYY-MM-DD");

      // เดือนนี้: เอาแถวล่าสุดของเดือนนี้
      current = await User_count.findOne({
        where: {
          count_date: {
            [Op.gte]: startThisMonth,
            [Op.lt]: startNextMonth,
          },
        },
        order: [["count_date", "DESC"]],
      });

      // เดือนก่อน: เอาแถวล่าสุดของเดือนก่อน
      previous = await User_count.findOne({
        where: {
          count_date: {
            [Op.gte]: startLastMonth,
            [Op.lt]: startThisMonth,
          },
        },
        order: [["count_date", "DESC"]],
      });
    } else {
      // --------------------------
      // ✅ แบบเก่า: รายเดือน (createdAt)
      // --------------------------
      const startOfThisMonth = moment.tz(tz).startOf("month").toDate();
      const endOfThisMonth = moment.tz(tz).endOf("month").toDate();

      const startOfLastMonth = moment.tz(tz).subtract(1, "month").startOf("month").toDate();
      const endOfLastMonth = moment.tz(tz).subtract(1, "month").endOf("month").toDate();

      current = await User_count.findOne({
        where: { createdAt: { [Op.between]: [startOfThisMonth, endOfThisMonth] } },
        order: [["createdAt", "DESC"]],
      });

      previous = await User_count.findOne({
        where: { createdAt: { [Op.between]: [startOfLastMonth, endOfLastMonth] } },
        order: [["createdAt", "DESC"]],
      });
    }

    const currentValue = Number(current?.total_user ?? 0);
    const previousValue = Number(previous?.total_user ?? 0);

    // 🧮 เปอร์เซ็นต์ (ไม่มีทศนิยม)
    let percentChange = 0;
    if (previousValue > 0) {
      percentChange = Number((((currentValue - previousValue) / previousValue) * 100).toFixed(2));
    }

    return {
      value: currentValue,
      percentChange, // decimal 2 digits
    };
  } catch (error) {
    return { value: 0, percentChange: 0 };
  }
};

exports.ChartUserCountReports = async ({ startDate, endDate }) => {
  const tz = "Asia/Bangkok";
  const nowTH = moment.tz(tz);

  // ✅ ช่วงวันแบบไทย (inclusive)
  const startTH = startDate
    ? moment.tz(startDate, "YYYY-MM-DD", tz).startOf("day")
    : nowTH.clone().startOf("day").subtract(29, "days");

  const endTH = endDate
    ? moment.tz(endDate, "YYYY-MM-DD", tz).startOf("day")
    : nowTH.clone().startOf("day");

  // กันกรณี start > end
  if (startTH.isAfter(endTH)) return [];

  // ✅ ใช้ [start, end+1) เพื่อ query ง่าย
  const startDateStr = startTH.format("YYYY-MM-DD");
  const endDateExclStr = endTH.clone().add(1, "day").format("YYYY-MM-DD");

  // 1) ดึงข้อมูลจาก user_count ในช่วงวัน
  // (ปกติ 1 วันมี 1 แถวอยู่แล้วเพราะ UNIQUE(count_date))
  const rows = await User_count.findAll({
    attributes: [
      [col("count_date"), "day"],
      [col("total_user"), "total_user"],
    ],
    where: {
      count_date: {
        [Op.gte]: startDateStr,
        [Op.lt]: endDateExclStr,
      },
    },
    order: [[col("count_date"), "ASC"]],
    raw: true,
  });

  // Map day -> total_user
  const map = new Map();
  for (const r of rows) {
    const d = String(r.day);
    map.set(d, Number(r.total_user ?? 0));
  }

  // 2) สร้างอาร์เรย์วัน (ไทย) แบบ inclusive
  const days = [];
  for (let cur = startTH.clone(); cur.isSameOrBefore(endTH); cur.add(1, "day")) {
    days.push(cur.format("YYYY-MM-DD"));
  }

  // 3) ทำ dense ให้ครบทุกวัน (ไม่มีข้อมูลให้เป็น 0)
  const dense = days.map((d) => ({
    date: d,
    total_user: map.get(d) ?? 0,
  }));

  return dense;
};