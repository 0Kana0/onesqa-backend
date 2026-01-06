const { Op } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Log } = db;
const { getLocale, getCurrentUser } = require("../utils/currentUser");

exports.listLogs = async ({ locale, page, pageSize, where = {} }) => {
  const limit = Math.max(parseInt(pageSize, 10) || 5, 1);
  const p = Math.max(Number(page) || 1, 1);
  const offset = (p - 1) * limit;

  const {
    logType,
    startDate,
    endDate,
    locale: whereLocale, // ✅ เพิ่ม locale ใน where
  } = where || {};

  const whereClause = {};

  // ✅ locale: ให้ where.locale มาก่อน ถ้าไม่ส่งมาใช้ locale param
  const localeToUse = whereLocale ?? locale;
  if (localeToUse) whereClause.locale = localeToUse; // <- ถ้าคอลัมน์ชื่ออื่น เปลี่ยนตรงนี้

  if (logType) whereClause.log_type = logType;

  const isDateOnly = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

  if (startDate || endDate) {
    const createdAt = {};

    if (startDate) {
      // ถ้าเป็น date-only ให้เริ่มที่ 00:00 ของวันนั้น
      createdAt[Op.gte] = isDateOnly(startDate)
        ? new Date(`${startDate}T00:00:00.000`)
        : new Date(startDate);
    }

    if (endDate) {
      if (isDateOnly(endDate)) {
        // ✅ ครอบคลุมทั้งวัน endDate โดยใช้ < วันถัดไป 00:00
        const nextDay = new Date(`${endDate}T00:00:00.000`);
        nextDay.setDate(nextDay.getDate() + 1);
        createdAt[Op.lt] = nextDay;
      } else {
        // ถ้ามีเวลาแนบมาแล้ว ใช้ lte ตามนั้น
        createdAt[Op.lte] = new Date(endDate);
      }
    }

    whereClause.createdAt = createdAt;
  }

  const order = [
    ["createdAt", "DESC"],
    ["id", "DESC"],
  ];

  const { rows, count } = await Log.findAndCountAll({
    where: whereClause,
    limit,
    offset,
    order,
  });

  return {
    items: rows,
    page: p,
    pageSize: limit,
    totalCount: count,
  };
};

exports.getLogById = async (id) => {
  return await Log.findByPk(id);
}

exports.createLog = async (input) => {
  // validation อื่น ๆ เช่น ชื่อห้ามซ้ำ:
  return await Log.create(input);
}

exports.updateLog = async (id, input, ctx) => {
  
  const locale = await getLocale(ctx);
  
  const row = await Log.findByPk(id);
  if (!row) throw new Error(locale === "th" ? "ไม่พบข้อมูล Log" : "Log not found");

  await row.update(input);
  return row;
}

exports.deleteLog = async (id) => {
  const count = await Log.destroy({ where: { id } });
  return count > 0;
}

exports.deleteLogs = async () => {
  const count = await Log.destroy({
    where: {}, // ✅ ไม่มีเงื่อนไข = ลบทั้งหมด
    truncate: true, // ✅ ล้างตารางแบบรีเซ็ต auto-increment ด้วย
  });
  return count >= 0; // ✅ คืน true เสมอหากลบสำเร็จ
};
