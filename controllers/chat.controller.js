// controllers/chat.controller.js
const { Op } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Chat } = db;
const { encodeCursor, decodeCursor } = require('../utils/cursor');

exports.listChats = async (chatgroup_id = null, user_id, { first = 20, after, search } = {}) => {
  const limit = Math.min(first, 100) + 1; // +1 เพื่อเช็ค hasNextPage

  // สร้าง AND เงื่อนไขหลัก
  const andConds = [{ user_id }];
  if (chatgroup_id != null) andConds.push({ chatgroup_id }); // ใส่เฉพาะเมื่อมีค่ามาจริง

  // เงื่อนไขค้นหา chat_name
  if (search && search.trim() !== "") {
    const q = search.trim();
    andConds.push({ chat_name: { [Op.iLike]: `%${q}%` } }); // Postgres
    // ถ้าเป็น MySQL: { chat_name: { [Op.like]: `%${q}%` } }
  }

  // Cursor boundary: (createdAt < X) OR (createdAt = X AND id < Y)
  if (after) {
    const { createdAt, id } = decodeCursor(after);
    andConds.push({
      [Op.or]: [
        { createdAt: { [Op.lt]: createdAt } },
        { [Op.and]: [{ createdAt }, { id: { [Op.lt]: id } }] },
      ],
    });
  }

  const rows = await Chat.findAll({
    where: { [Op.and]: andConds },
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