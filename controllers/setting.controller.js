const { Op } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Setting } = db;

exports.listSettings = async () => {
  return await Setting.findAll({
    order: [['id', 'ASC']],
  });
}

exports.getSettingById = async (id) => {
  return await Setting.findByPk(id);
}

exports.createSetting = async (input) => {
  // validation อื่น ๆ เช่น ชื่อห้ามซ้ำ:
  return await Setting.create(input);
}

exports.updateSetting = async (id, input) => {
  const row = await Setting.findByPk(id);
  if (!row) throw new Error('Setting not found');

  await row.update(input);
  return row;
}

exports.deleteSetting = async (id) => {
  const count = await Setting.destroy({ where: { id } });
  return count > 0;
}
