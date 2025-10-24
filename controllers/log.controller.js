const { Op } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Log } = db;

exports.listLogs = async ({ page = 1, pageSize = 5, where = {} }) => {
  const limit = Math.min(Math.max(Number(pageSize) || 5, 1), 100);
  const p = Math.max(Number(page) || 1, 1);
  const offset = (p - 1) * limit;

  const { logType, startDate, endDate } = where || {};

  const whereClause = {};
  if (logType) whereClause.log_type = logType;

  if (startDate || endDate) {
    const createdAt = {};
    if (startDate) createdAt[Op.gte] = new Date(startDate);
    if (endDate) {
      // ถ้าส่งมาเป็นวันที่อย่างเดียว แปลงให้เป็น end-of-day เพื่อ inclusive
      const end = new Date(endDate);
      if (end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0 && end.getMilliseconds() === 0) {
        end.setHours(23, 59, 59, 999);
      }
      createdAt[Op.lte] = end;
    }
    whereClause.createdAt = createdAt;
  }

  const order = [
    ['createdAt', 'DESC'],
    ['id', 'DESC'],
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

exports.updateLog = async (id, input) => {
  const row = await Log.findByPk(id);
  if (!row) throw new Error('Log not found');

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
