// controllers/chatgroup.controller.js
const { Op } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Chatgroup } = db;

exports.listChatgroups = async ({ user_id }) => {
  return await Chatgroup.findAll({
    where: { user_id: user_id },
    order: [['id', 'DESC']],
  });
}

exports.getChatgroupById = async (id) => {
  return await Chatgroup.findByPk(id);
}

exports.createChatgroup = async (input) => {
  // validation อื่น ๆ เช่น ชื่อห้ามซ้ำ:
  return await Chatgroup.create(input);
}

exports.updateChatgroup = async (id, input) => {
  const row = await Chatgroup.findByPk(id);
  if (!row) throw new Error('Chatgroup not found');

  await row.update(input);
  return row;
}

exports.deleteChatgroup = async (id) => {
  const count = await Chatgroup.destroy({ where: { id } });
  return count > 0;
}