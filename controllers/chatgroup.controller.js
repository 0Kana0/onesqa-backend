// controllers/chatgroup.controller.js
const { Op } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Chatgroup, Chat } = db;
const { encodeCursor, decodeCursor } = require('../utils/cursor');
const { getLocale, getCurrentUser } = require("../utils/currentUser");

exports.listChatgroups = async (
  id,
  user_id,
  { first = 20, after, search } = {}
) => {
  const pageSize = Math.max(1, parseInt(first, 10) || 20);
  const limit = pageSize + 1; // +1 เพื่อเช็ค hasNextPage

  // --- AND เงื่อนไขหลัก ---
  const andConds = [{ user_id }];

  // --- ตัด chatgroup ที่มี id เท่ากับค่าที่ส่งมา ---
  if (id != null) {
    andConds.push({
      id: { [Op.ne]: id }   // != id
    });
  }

  // --- ค้นหาชื่อกลุ่ม ---
  if (search && search.trim() !== '') {
    const q = search.trim();
    andConds.push({ chatgroup_name: { [Op.iLike]: `%${q}%` } }); // MySQL: Op.like
  }

  // --- Cursor boundary (DESC) ---
  if (after) {
    const { createdAt, id } = decodeCursor(after);
    andConds.push({
      [Op.or]: [
        { createdAt: { [Op.lt]: createdAt } },
        { [Op.and]: [{ createdAt }, { id: { [Op.lt]: id } }] },
      ],
    });
  }

  const rows = await Chatgroup.findAll({
    where: { [Op.and]: andConds },
    order: [
      ['updatedAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit,
    include: [
      {
        model: Chat,                // ต้องมี association: Chatgroup.hasMany(Chat, { as: 'chat', foreignKey: 'chatgroup_id' })
        as: 'chat',
        separate: true,             // กัน limit/ordering ของ Chatgroup ไม่เพี้ยน
        order: [
          ['updatedAt', 'DESC'],
          ['id', 'DESC'],
        ],
        // ถ้าต้องการลด payload:
        // attributes: ['id','chatgroup_id','title','createdAt','updatedAt'],
        // limit: 5, // อยากจำกัดจำนวนแชตต่อกลุ่ม ใส่ได้
      },
    ],
  });

  const hasNextPage = rows.length > pageSize;
  const slice = hasNextPage ? rows.slice(0, pageSize) : rows;

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
};

exports.getChatgroupById = async (id, user_id) => {
  const where = { id };
  if (user_id != null) where.user_id = user_id; // ✅ มีค่าเมื่อไหร่ค่อยกรอง

  return await Chatgroup.findOne({ where });
};

exports.createChatgroup = async (input) => {
  // validation อื่น ๆ เช่น ชื่อห้ามซ้ำ:
  return await Chatgroup.create(input);
}

exports.updateChatgroup = async (id, input, ctx) => {

  const locale = await getLocale(ctx);

  const row = await Chatgroup.findByPk(id);
  if (!row) throw new Error(locale === "th" ? "ไม่พบกลุ่มแชต" : "Chatgroup not found");

  await row.update(input);
  return row;
}

exports.deleteChatgroup = async (id) => {
  const count = await Chatgroup.destroy({ where: { id } });
  return count > 0;
}