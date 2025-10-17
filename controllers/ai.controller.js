// controllers/ai.controller.js
const { Op } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Ai } = db;

/**
 * แยก DB logic สำหรับ Ai ออกมา
 * - สามารถเขียน validation เพิ่มเติม/ธุรกิจลอจิกตรงนี้
 * - ทดสอบแยกหน่วย (unit test) ได้ง่าย
 */

exports.listAis = async () => {
  const today = 50000;
  const average = 40000;

  const items = await Ai.findAll({
    order: [['id', 'ASC']],
    raw: true, // ✅ คืนค่ามาเป็น plain object ทันที
  });

  return items.map((item) => ({
    ...item,
    today,
    average,
  }));
};

exports.getAiById = async (id) => {
  return await Ai.findByPk(id);
}

exports.createAi = async (input) => {
  if (input.token_count < 0) {
    throw new Error('token_count must be >= 0');
  }
  if (input.token_all < 0) {
    throw new Error('token_all must be >= 0');
  }
  // validation อื่น ๆ เช่น ชื่อห้ามซ้ำ:
  const exists = await Ai.findOne({ where: { model_name: input.model_name } });
  if (exists) throw new Error('model_name already exists');
  return await Ai.create(input);
}

exports.updateAi = async (id, input) => {
  const row = await Ai.findByPk(id);
  if (!row) throw new Error('Ai not found');

  if (input?.token_count != null && input.token_count < 0) {
    throw new Error('token_count must be >= 0');
  }
  if (input?.token_all != null && input.token_all < 0) {
    throw new Error('token_all must be >= 0');
  }

  if (input.token_count < row.token_count) {
    throw new Error('จำนวน token ไม่สามารถเเก้ไขให้ลดลงได้');
  }

  await row.update(input);
  return row;
}

exports.deleteAi = async (id) => {
  const count = await Ai.destroy({ where: { id } });
  return count > 0;
}
