// controllers/ai_backup.controller.js
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Ai_backup } = db;

exports.listAiBackups = async () => {
  return await Ai_backup.findAll({
    order: [['id', 'ASC']],
  });
}