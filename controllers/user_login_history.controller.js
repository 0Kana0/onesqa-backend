// controllers/user_login_history.controller.js
const { Op, fn, col, where: whereFn } = require("sequelize");
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { User, User_login_history, User_role, Role } = db;
const moment = require("moment-timezone");

const TZ = "Asia/Bangkok";

exports.listUsersLoginHistory = async ({ page, pageSize, where = {} }) => {
  const limit = Math.max(parseInt(pageSize, 10) || 5, 1);
  const p = Math.max(Number(page) || 1, 1);
  const offset = (p - 1) * limit;

  const TZ = "Asia/Bangkok";
  const { search, event_type, startDate, endDate } = where || {};

  const normalizeText = (v) => {
    const s = String(v ?? "")
      .replace(/\s+/g, " ")
      .trim();
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

  // event_type
  if (normalizeText(event_type)) {
    const et = String(event_type).trim().toUpperCase();
    if (["LOGIN_SUCCESS", "LOGOUT"].includes(et)) historyWhere.event_type = et;
  }

  // createdAt range
  if (startParam || endParam) {
    historyWhere.createdAt = {};
    if (startParam) historyWhere.createdAt[Op.gte] = startParam;
    if (endParam) historyWhere.createdAt[Op.lte] = endParam;
  }

  // ✅ search เฉพาะ: fullname + group_name
  if (q) {
    historyWhere[Op.or] = [
      // ชื่อ + นามสกุล
      whereFn(
        fn("concat_ws", " ", col("user.firstname"), col("user.lastname")),
        {
          [Op.iLike]: q,
        },
      ),

      // group_name
      { "$user.group_name$": { [Op.iLike]: q } },
    ];
  }

  // Query 1: id + count
  const { rows: idRows, count } = await User_login_history.findAndCountAll({
    where: historyWhere,
    attributes: ["id"],
    include: [
      {
        model: User,
        as: "user",
        required: false,
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

  // Query 2: full include
  const includeUserRole = {
    model: User_role,
    as: "user_role",
    required: false,
    include: [
      {
        model: Role,
        as: "role",
        attributes: ["role_name_th", "role_name_en"],
        required: false,
      },
    ],
  };

  const items = await User_login_history.findAll({
    where: { id: { [Op.in]: ids } },
    include: [
      {
        model: User,
        as: "user",
        required: false,
        attributes: { exclude: ["password"] },
        include: [includeUserRole],
      },
    ],
    order: [["id", "DESC"]],
  });

  return { items, page: p, pageSize: limit, totalCount: count };
};

exports.deleteLoginHistorys = async () => {
  const count = await User_login_history.destroy({
    where: {}, // ✅ ไม่มีเงื่อนไข = ลบทั้งหมด
    truncate: true, // ✅ ล้างตารางแบบรีเซ็ต auto-increment ด้วย
  });
  return count >= 0; // ✅ คืน true เสมอหากลบสำเร็จ
};