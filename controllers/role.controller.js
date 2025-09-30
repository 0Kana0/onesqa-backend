// controllers/role.controller.js
const { Op } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Role } = db;

/**
 * แยก DB logic สำหรับ Role ออกมา
 * - สามารถเขียน validation เพิ่มเติม/ธุรกิจลอจิกตรงนี้
 * - ทดสอบแยกหน่วย (unit test) ได้ง่าย
 */

exports.listRoles = async () => {
  return await Role.findAll({
    order: [['id', 'ASC']],
  });
}

exports.getRoleById = async (id) => {
  return await Role.findByPk(id);
}

exports.createRole = async (input) => {
  // if (input.token_count < 0) {
  //   throw new Error('token_count must be >= 0');
  // }
  // validation อื่น ๆ เช่น ชื่อห้ามซ้ำ:
  const exists = await Role.findOne({ where: { role_name: input.role_name } });
  if (exists) throw new Error('role_name already exists');
  return await Role.create(input);
}

exports.updateRole = async (id, input) => {
  const row = await Role.findByPk(id);
  if (!row) throw new Error('Role not found');

  // if (input?.token_count != null && input.token_count < 0) {
  //   throw new Error('token_count must be >= 0');
  // }
  await row.update(input);
  return row;
}

exports.deleteRole = async (id) => {
  const count = await Role.destroy({ where: { id } });
  return count > 0;
}
