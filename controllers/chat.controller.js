// controllers/chat.controller.js
const { Op } = require("sequelize");
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Chat, Ai, Message, File } = db;
const { encodeCursor, decodeCursor } = require("../utils/cursor");
const { deleteMultipleFiles } = require("../utils/fileUtils");
const { checkTokenQuota } = require("../utils/checkTokenQuota");

exports.listChats = async (
  chatgroup_id = null,
  user_id,
  { first = 20, after, search, chatgroupMode = "ALL" } = {}
) => {
  const limit = Math.min(first, 100) + 1; // +1 เพื่อเช็ค hasNextPage

  // สร้าง AND เงื่อนไขหลัก
  const andConds = [{ user_id }];

  // --- กรองตาม chatgroup ---
  if (chatgroup_id != null) {
    // ส่งค่า id มา -> กรองเท่ากับค่านั้น (เดิม)
    andConds.push({ chatgroup_id });
  } else {
    // ไม่ได้ส่ง id มา -> ใช้โหมดกรอง
    if (chatgroupMode === "NULL") {
      andConds.push({ chatgroup_id: { [Op.is]: null } });
    } else if (chatgroupMode === "NOT_NULL") {
      andConds.push({ chatgroup_id: { [Op.not]: null } }); // IS NOT NULL
    }
    // chatgroupMode === "ALL" -> ไม่เพิ่มเงื่อนไข (ได้ทั้งหมด)
  }

  // --- ค้นหาชื่อแชต ---
  if (search && search.trim() !== "") {
    const q = search.trim();
    andConds.push({ chat_name: { [Op.iLike]: `%${q}%` } }); // Postgres
    // MySQL: { chat_name: { [Op.like]: `%${q}%` } }
  }

  // --- Cursor boundary ---
  if (after) {
    const { createdAt, id } = decodeCursor(after);
    andConds.push({
      [Op.or]: [
        { createdAt: { [Op.lt]: createdAt } },
        { [Op.and]: [{ createdAt }, { id: { [Op.lt]: id } }] },
      ],
    });
  }

  const includeAi = {
    model: Ai,
    as: "ai",
    attributes: ["model_name", "model_use_name", "model_type"],
    required: false,
  };

  const rows = await Chat.findAll({
    where: { [Op.and]: andConds },
    include: [includeAi],
    order: [
      ["createdAt", "DESC"],
      ["id", "DESC"],
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
};

exports.getChatById = async (id) => {
  return await Chat.findByPk(id, {
    include: [
      {
        model: Ai,
        as: "ai",
        attributes: ["model_name", "model_use_name", "model_type"],
        required: false,
      },
    ],
  });
};

exports.createChat = async (input) => {
  const { ai_id, user_id } = input;
  // ห้ามส่งคำถามถ้าเหลือ token ของ user ทั้งหมดเหลือไม่ถึง 15%
  await checkTokenQuota({
    aiId: ai_id,
    userId: user_id,
    // minPercent: 15, // ไม่ส่งก็ได้ ใช้ค่า default
  });
  
  // validation อื่น ๆ เช่น ชื่อห้ามซ้ำ:
  return await Chat.create(input);
};

exports.updateChat = async (id, input) => {
  const row = await Chat.findByPk(id);
  if (!row) throw new Error("Chat not found");

  await row.update(input);
  return row;
};

exports.deleteChat = async (id) => {
  const deleteMessage = await Message.findAll({
    attributes: ["id"],
    where: { chat_id: id },
    order: [["id", "ASC"]],
    include: [
      {
        model: File, // ต้องมี association: Chatgroup.hasMany(Chat, { as: 'chat', foreignKey: 'chatgroup_id' })
        as: "files",
        attributes: ["id", "file_name", "stored_path"],
        required: true, // บังคับว่าต้องแมตช์ role ด้วย
        separate: true, // กัน limit/ordering ของ Chatgroup ไม่เพี้ยน
      },
    ],
  });

  // ดึงชื่อไฟล์ทั้งหมด
  const allFileNames = deleteMessage.flatMap((msg) =>
    msg.files.map((f) => f.file_name)
  );

  console.log(allFileNames);
  await deleteMultipleFiles(allFileNames);

  const count = await Chat.destroy({ where: { id } });
  return count > 0;
};
