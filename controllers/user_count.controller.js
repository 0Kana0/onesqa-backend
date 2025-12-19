// controllers/user_count.controller.js
const { Op, fn, col, literal, QueryTypes } = require('sequelize');
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { User_count } = db;
const moment = require("moment-timezone");

exports.CardUserCountReports = async () => {
  try {
    // 🌏 กำหนด timezone ไทย
    const tz = "Asia/Bangkok";

    // 📅 เดือนปัจจุบัน
    const startOfThisMonth = moment.tz(tz).startOf("month").toDate();
    const endOfThisMonth = moment.tz(tz).endOf("month").toDate();

    // 📅 เดือนก่อนหน้า
    const startOfLastMonth = moment
      .tz(tz)
      .subtract(1, "month")
      .startOf("month")
      .toDate();

    const endOfLastMonth = moment
      .tz(tz)
      .subtract(1, "month")
      .endOf("month")
      .toDate();

    // 🔹 ข้อมูลเดือนนี้
    const current = await User_count.findOne({
      where: {
        createdAt: {
          [Op.between]: [startOfThisMonth, endOfThisMonth],
        },
      },
      order: [["createdAt", "DESC"]],
    });

    // 🔹 ข้อมูลเดือนก่อน
    const previous = await User_count.findOne({
      where: {
        createdAt: {
          [Op.between]: [startOfLastMonth, endOfLastMonth],
        },
      },
      order: [["createdAt", "DESC"]],
    });

    const currentValue = current?.total_user ?? 0;
    const previousValue = previous?.total_user ?? 0;

    // 🧮 เปอร์เซ็นต์ (ไม่มีทศนิยม)
    let percentChange = 0;
    if (previousValue > 0) {
      percentChange = Number(
        (
          ((currentValue - previousValue) / previousValue) * 100
        ).toFixed(2)
      );
    }

    return {
      value: currentValue,
      percentChange, // decimal 2 digits
    };
  } catch (error) {
    // กันทุกอย่างอีกชั้น (เช่น moment/Op/Model ยังไม่พร้อม)
    return {
      value: 0,
      percentChange: 0,
    };
  }
}