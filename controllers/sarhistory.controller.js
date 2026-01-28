// controllers/sarhistory.controller.js
const { Op, fn, col, where: whereFn } = require("sequelize");
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { SarHistory, Academy } = db;
const moment = require("moment-timezone");

const TZ = "Asia/Bangkok";

exports.listSarHistory = async ({ page, pageSize, where = {} }) => {
  const limit = Math.max(parseInt(pageSize, 10) || 5, 1);
  const p = Math.max(Number(page) || 1, 1);
  const offset = (p - 1) * limit;

  const { search, startDate, endDate } = where || {};

  const normalizeText = (v) => {
    const s = String(v ?? "").replace(/\s+/g, " ").trim();
    return s === "" ? null : s;
  };

  const parseDateTime = (v) => {
    const raw = normalizeText(v);
    if (!raw) return null;
    const hasTZ = /z$|[+-]\d\d:\d\d$/i.test(raw);
    const m = hasTZ ? moment(raw) : moment.tz(raw, TZ);
    return m.isValid() ? m.toDate() : null;
  };

  const qText = normalizeText(search);
  const q = qText ? `%${qText}%` : null;

  const startParam = parseDateTime(startDate);
  const endParam = parseDateTime(endDate);

  const historyWhere = {};

  if (startParam || endParam) {
    historyWhere.createdAt = {};
    if (startParam) historyWhere.createdAt[Op.gte] = startParam;
    if (endParam) historyWhere.createdAt[Op.lte] = endParam;
  }

  // ✅ search จาก academy.name + academy.code
  if (q) {
    historyWhere[Op.or] = [
      { "$academy.name$": { [Op.iLike]: q } },
      { "$academy.code$": { [Op.iLike]: q } },
    ];
  }

  // Query 1: ids + count
  const { rows: idRows, count } = await SarHistory.findAndCountAll({
    where: historyWhere,
    attributes: ["id"],
    include: [
      {
        model: Academy,
        as: "academy",
        required: true, // ✅ เพราะ schema academy: Academy! (ห้ามเป็น null)
        attributes: [],
      },
    ],
    order: [["id", "DESC"]],
    limit,
    offset,
    distinct: true,
    subQuery: false,
  });

  const ids = idRows.map((r) => r.id);
  if (ids.length === 0) {
    return { items: [], page: p, pageSize: limit, totalCount: count };
  }

  // Query 2: full include (field ครบตาม schema)
  const items = await SarHistory.findAll({
    where: { id: { [Op.in]: ids } },
    include: [
      {
        model: Academy,
        as: "academy",
        required: true,
        attributes: [
          "id",
          "academy_api_id",
          "name",
          "code",
          "academy_level_id",
          "sar_file",
          "createdAt",
          "updatedAt",
        ],
      },
    ],
    order: [["id", "DESC"]],
  });

  // แนะนำ: แปลงเป็น plain object เพื่อให้ GraphQL serialize ง่าย
  const plainItems = items.map((x) => x.get({ plain: true }));

  return { items: plainItems, page: p, pageSize: limit, totalCount: count };
};

exports.deleteSarHistorys = async () => {
  const count = await SarHistory.destroy({
    where: {}, // ✅ ไม่มีเงื่อนไข = ลบทั้งหมด
    truncate: true, // ✅ ล้างตารางแบบรีเซ็ต auto-increment ด้วย
  });
  return count >= 0; // ✅ คืน true เสมอหากลบสำเร็จ
};