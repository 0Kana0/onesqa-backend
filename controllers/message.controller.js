// controllers/message.controller.js
const { Op } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Message } = db;

exports.listMessages = async ({ chat_id }) => {
  return await Message.findAll({
    where: { chat_id: chat_id },
    order: [['id', 'DESC']],
  });
}

exports.getMessageById = async (id) => {
  return await Message.findByPk(id);
}

exports.createMessage = async (input) => {
  // validation อื่น ๆ เช่น ชื่อห้ามซ้ำ:
  return await Message.create(input);
}

exports.updateMessage = async (id, input) => {
  const row = await Message.findByPk(id);
  if (!row) throw new Error('Message not found');

  await row.update(input);
  return row;
}

exports.deleteMessage = async (id) => {
  const count = await Message.destroy({ where: { id } });
  return count > 0;
}