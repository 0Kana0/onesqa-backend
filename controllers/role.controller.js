// controllers/role.controller.js
const { Op } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Role } = db;
const { getLocale, getCurrentUser } = require("../utils/currentUser");

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

exports.createRole = async (input, ctx) => {

  const locale = await getLocale(ctx);

  // validation อื่น ๆ เช่น ชื่อห้ามซ้ำ:
  const exists = await Role.findOne({ where: { role_name_th: input.role_name_th } });
  if (exists) throw new Error(
    locale === "th"
      ? "มี role_name นี้อยู่แล้ว"
      : "role_name already exists"
  );
  return await Role.create(input);
}

exports.updateRole = async (id, input, ctx) => {

  const locale = await getLocale(ctx);

  const row = await Role.findByPk(id);
  if (!row) throw new Error(locale === "th" ? "ไม่พบบทบาท" : "Role not found");

  await row.update(input);
  return row;
}

exports.deleteRole = async (id) => {
  const count = await Role.destroy({ where: { id } });
  return count > 0;
}
