const { Op } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Log } = db;

exports.listLogs = async () => {
  return await Log.findAll({
    order: [['id', 'DESC']],
  });
}

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
