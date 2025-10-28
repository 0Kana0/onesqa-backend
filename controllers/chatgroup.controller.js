// controllers/chatgroup.controller.js
const { Op } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Chatgroup } = db;
const { encodeCursor, decodeCursor } = require('../utils/cursor');

exports.listChatgroups = async (user_id, { first = 20, after } = {}) => {
  const limit = Math.min(first, 100) + 1; // +1 เพื่อเช็ค hasNextPage
  const where = { user_id };
  
  if (after) {
    const { createdAt, id } = decodeCursor(after);
    // เรียง DESC -> ดึง “ถัดไป” คือรายการที่ createdAt < หรือ (createdAt เท่ากันและ id <)
    where[Op.or] = [
      { createdAt: { [Op.lt]: createdAt } },
      {
        [Op.and]: [{ createdAt }, { id: { [Op.lt]: id } }],
      },
    ];
  }

  const rows = await Chatgroup.findAll({
    where,
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit,
  });

  const hasNextPage = rows.length > Math.min(first, 100);
  const slice = hasNextPage ? rows.slice(0, Math.min(first, 100)) : rows;

  const edges = slice.map((row) => ({
    node: row,
    cursor: encodeCursor(row),
  }));

  const endCursor = edges.length ? edges[edges.length - 1].cursor : null;

  return {
    edges,
    pageInfo: {
      hasNextPage,
      endCursor,
    },
  };
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