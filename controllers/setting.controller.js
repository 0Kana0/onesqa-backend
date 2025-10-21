const { Op } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Setting } = db;
const { auditLog } = require('../utils/auditLog'); // ปรับ path ให้ตรง

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

exports.updateSetting = async (id, input, ctx) => {
  const row = await Setting.findByPk(id);
  if (!row) throw new Error('Setting not found');

  //console.log("row", row);
  // console.log("input", input.activity);
  // console.log("ctx", ctx?.req?.user);

  // ถ้ามีการเปลี่ยนแปลงสถานะ ให้ทำการเก็บ log ไว้
  await auditLog({
    ctx,
    log_type: 'ALERT',
    old_data: row.setting_name,
    new_data: input?.setting_name ?? row.setting_name,
    old_status: row.activity,
    new_status: input?.activity,
  });

  await row.update(input);
  return row;
}

exports.deleteSetting = async (id) => {
  const count = await Setting.destroy({ where: { id } });
  return count > 0;
}
