// controllers/chat.controller.js
const { Op } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Chat } = db;

exports.listChats = async ({ chatgroup_id, user_id }) => {
  return await Chat.findAll({
    where: { 
      user_id: user_id,
      chatgroup_id: chatgroup_id
    },
    order: [['id', 'DESC']],
  });
}

exports.getChatById = async (id) => {
  return await Chat.findByPk(id);
}

exports.createChat = async (input) => {
  // validation อื่น ๆ เช่น ชื่อห้ามซ้ำ:
  return await Chat.create(input);
}

exports.updateChat = async (id, input) => {
  const row = await Chat.findByPk(id);
  if (!row) throw new Error('Chat not found');

  await row.update(input);
  return row;
}

exports.deleteChat = async (id) => {
  const count = await Chat.destroy({ where: { id } });
  return count > 0;
}