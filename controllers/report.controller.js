// controllers/role.controller.js
const { Op, fn, col, literal, QueryTypes } = require('sequelize');
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Chat, Message, User, Ai, User_token } = db;
const moment = require("moment-timezone");

/**
 * แยก DB logic สำหรับ Role ออกมา
 * - สามารถเขียน validation เพิ่มเติม/ธุรกิจลอจิกตรงนี้
 * - ทดสอบแยกหน่วย (unit test) ได้ง่าย
 */

const TZ = 'Asia/Bangkok';
const tzDaySql = `("Message"."createdAt" AT TIME ZONE 'Asia/Bangkok')::date`;
const tzDay = literal(tzDaySql);

const RANK_COLORS = {
  1: '#FFD1D1',
  2: '#FFEDB7',
  3: '#FFF6D4',
  4: '#F9F9F9',
  5: '#F9F9F9',
};

moment.tz.setDefault("Asia/Bangkok");

exports.listReports = async ({ page, pageSize, where = {} }) => {
  const limit = Math.max(parseInt(pageSize, 10) || 5, 1);
  const p = Math.max(Number(page) || 1, 1);
  const offset = (p - 1) * limit;

  const { startDate, endDate } = where || {};
  const TZ = "Asia/Bangkok";

  // --- ช่วงเวลาแบบ [start, nextDay) โซนไทย ---
  let startParam = null;
  let endParam = null;

  if (startDate) startParam = new Date(`${startDate}T00:00:00.000+07:00`);
  if (endDate) {
    const nextDay = new Date(`${endDate}T00:00:00.000+07:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    endParam = nextDay;
  }

  const sequelize = User_token.sequelize;

  const repl = {
    tz: TZ,
    start: startParam,
    end: endParam,
    limit,
    offset,
  };

  // ✅ base = message (ได้ chats แบบเดิม) แล้ว LEFT JOIN tokens จาก user_token
  const itemsSql = `
    WITH msg_chats AS (
      SELECT
        c.user_id,
        (m."createdAt" AT TIME ZONE :tz)::date AS date,
        FLOOR(COUNT(m.id) / 2.0)::int AS chats
      FROM message m
      JOIN chat c ON c.id = m.chat_id
      WHERE (:start IS NULL OR m."createdAt" >= :start)
        AND (:end   IS NULL OR m."createdAt" <  :end)
      GROUP BY c.user_id, date
    ),
    ut_tokens AS (
      SELECT
        ut.user_id,
        (ut."createdAt" AT TIME ZONE :tz)::date AS date,
        COALESCE(SUM(ut.total_token), 0)::bigint AS tokens
      FROM user_token ut
      WHERE (:start IS NULL OR ut."createdAt" >= :start)
        AND (:end   IS NULL OR ut."createdAt" <  :end)
      GROUP BY ut.user_id, date
    )
    SELECT
      ROW_NUMBER() OVER (ORDER BY mc.date DESC, mc.user_id DESC) AS id,
      mc.user_id,
      COALESCE(u.firstname || ' ' || u.lastname, '-') AS "user",
      u.position AS position,
      mc.date AS date,
      mc.chats AS chats,
      COALESCE(ut.tokens, 0) AS tokens
    FROM msg_chats mc
    LEFT JOIN ut_tokens ut
      ON ut.user_id = mc.user_id AND ut.date = mc.date
    LEFT JOIN "user" u
      ON u.id = mc.user_id
    ORDER BY mc.date DESC, mc.user_id DESC
    LIMIT :limit OFFSET :offset;
  `;

  const rows = await sequelize.query(itemsSql, {
    replacements: repl,
    type: QueryTypes.SELECT,
  });

  // ✅ totalCount แบบเดิม: นับจำนวนกลุ่ม (user_id + day) จาก message
  const countSql = `
    WITH msg_chats AS (
      SELECT
        c.user_id,
        (m."createdAt" AT TIME ZONE :tz)::date AS date
      FROM message m
      JOIN chat c ON c.id = m.chat_id
      WHERE (:start IS NULL OR m."createdAt" >= :start)
        AND (:end   IS NULL OR m."createdAt" <  :end)
      GROUP BY c.user_id, date
    )
    SELECT COUNT(*)::int AS cnt FROM msg_chats;
  `;

  const [{ cnt: totalCount }] = await sequelize.query(countSql, {
    replacements: repl,
    type: QueryTypes.SELECT,
  });

  return {
    items: rows,
    page: p,
    pageSize: limit,
    totalCount,
  };
};

exports.CardMessageReports = async () => {
  try {
    const TZ = 'Asia/Bangkok'; // ขอบเขตเดือนอิงเวลาไทย
    const startThisMonth = moment.tz(TZ).startOf('month').toDate();
    const endThisMonth   = moment(startThisMonth).add(1, 'month').toDate();

    const startLastMonth = moment(startThisMonth).subtract(1, 'month').toDate();
    const endLastMonth   = startThisMonth;

    // .catch(() => 0) กัน error ระดับ query ให้คืน 0
    const [thisMonthRaw, lastMonthRaw] = await Promise.all([
      Message.count({
        where: { createdAt: { [Op.gte]: startThisMonth, [Op.lt]: endThisMonth } },
      }).catch(() => 0),
      Message.count({
        where: { createdAt: { [Op.gte]: startLastMonth, [Op.lt]: endLastMonth } },
      }).catch(() => 0),
    ]);

    // กันค่าประหลาด (เช่น undefined/NaN) ให้เป็น 0 เสมอ
    const thisMonth = Number.isFinite(thisMonthRaw) ? thisMonthRaw : 0;
    const lastMonth = Number.isFinite(lastMonthRaw) ? lastMonthRaw : 0;

    const diff = thisMonth - lastMonth;

    // ถ้าเดือนที่แล้วเป็น 0 → เลี่ยงหารศูนย์
    const percentChange =
      lastMonth === 0
        ? 0
        : Number(((diff / lastMonth) * 100).toFixed(2));

    return {
      value: Math.floor(thisMonth / 2), // ตาม logic เดิมของคุณ
      percentChange, // decimal 2 หลัก
    };
  } catch (e) {
    // กันทุกอย่างอีกชั้น (เช่น moment/Op/Model ยังไม่พร้อม)
    return {
      value: 0,
      percentChange: 0,
    };
  }
};

exports.CardTokenReports = async () => {
  try {
    const TZ = "Asia/Bangkok";

    // ✅ ขอบเขตเดือนตามเวลาไทย แล้วแปลงเป็น Date (UTC instant) เพื่อ query createdAt
    const startThisMonth = moment.tz(TZ).startOf("month").toDate();
    const endThisMonth = moment.tz(TZ).startOf("month").add(1, "month").toDate();

    const startLastMonth = moment.tz(TZ).startOf("month").subtract(1, "month").toDate();
    const endLastMonth = startThisMonth;

    const [sumThisRaw, sumLastRaw] = await Promise.all([
      User_token.sum("total_token", {
        where: { createdAt: { [Op.gte]: startThisMonth, [Op.lt]: endThisMonth } },
      }).catch(() => 0),
      User_token.sum("total_token", {
        where: { createdAt: { [Op.gte]: startLastMonth, [Op.lt]: endLastMonth } },
      }).catch(() => 0),
    ]);

    const normalize = (v) => {
      if (v == null) return 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const thisMonth = normalize(sumThisRaw);
    const lastMonth = normalize(sumLastRaw);

    const diff = thisMonth - lastMonth;

    const percentChange =
      lastMonth === 0 ? 0 : Number(((diff / lastMonth) * 100).toFixed(2));

    return {
      value: thisMonth,
      percentChange,
    };
  } catch (e) {
    return { value: 0, percentChange: 0 };
  }
};

exports.ChartReports = async ({ startDate, endDate }) => {
  const tz = "Asia/Bangkok";
  const createdAtMode = "auto";
  const activeOnly = false;

  // 1) สร้างช่วงเวลาไทย แล้วแปลงเป็น UTC สำหรับ where createdAt
  const nowTH = moment.tz(tz);

  const startTH = startDate
    ? moment.tz(`${startDate} 00:00:00`, "YYYY-MM-DD HH:mm:ss", tz)
    : nowTH.clone().startOf("day").subtract(29, "days");

  const endTHExclusive = endDate
    ? moment.tz(`${endDate} 00:00:00`, "YYYY-MM-DD HH:mm:ss", tz).add(1, "day")
    : nowTH.clone().endOf("day").add(1, "millisecond");

  const startUTC = startTH.clone().tz("UTC");
  const endUTC = endTHExclusive.clone().tz("UTC");

  const whereClause = {
    createdAt: {
      [Op.gte]: startUTC.toDate(),
      [Op.lt]: endUTC.toDate(),
    },
  };

  // 2) นิพจน์ตัดวันตามเวลาไทยไว้ group
  const dayExpr =
    createdAtMode === "timestamp"
      ? `DATE_TRUNC('day', ("User_token"."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE '${tz}'))`
      : `DATE_TRUNC('day', ("User_token"."createdAt" AT TIME ZONE '${tz}'))`;

  // 3) คิวรีรวมจริง: รวม token จาก user_token แยกตามวัน + โมเดล
  const aggRows = await User_token.findAll({
    attributes: [
      [literal(dayExpr), "day_th"],
      [col("ai.model_use_name"), "model"],
      [fn("SUM", col("User_token.total_token")), "total_tokens"],
    ],
    include: [
      {
        model: Ai,
        as: "ai",
        attributes: [],
        required: false, // ถ้า ai_id เป็น null ก็ยังให้รวมได้ (model จะเป็น null)
      },
    ],
    where: whereClause,
    group: [literal(dayExpr), col("ai.model_use_name")],
    order: [[literal("day_th"), "ASC"], [col("ai.model_use_name"), "ASC"]],
    raw: true,
  });

  // Map key = `${YYYY-MM-DD}|${model}`
  const aggMap = new Map();
  for (const r of aggRows) {
    const d = moment.tz(r.day_th, tz).format("YYYY-MM-DD");
    const m = r.model ?? "UNKNOWN";
    aggMap.set(`${d}|${m}`, Number(r.total_tokens || 0));
  }

  // 4) โหลดรายชื่อโมเดลทั้งหมด
  const aiWhere = activeOnly ? { activity: true } : {};
  const aiList = await Ai.findAll({
    attributes: ["model_use_name"],
    where: aiWhere,
    raw: true,
  });
  const models = aiList.map((a) => a.model_use_name).sort();

  if (models.length === 0) return [];

  // 5) สร้างอาร์เรย์วัน (ไทย)
  const days = [];
  for (let cur = startTH.clone(); cur.isBefore(endTHExclusive); cur.add(1, "day")) {
    days.push(cur.format("YYYY-MM-DD"));
  }

  // 6) เติมให้ครบ วัน × โมเดล
  const dense = [];
  for (const d of days) {
    for (const m of models) {
      dense.push({
        date: d,
        model: m,
        total_tokens: aggMap.get(`${d}|${m}`) ?? 0,
      });
    }
  }

  return dense;
};

exports.TopFiveReports = async () => {
  const TZ = "Asia/Bangkok";

  // ✅ ช่วงเดือนปัจจุบันตามเวลาไทย แล้วแปลงเป็น Date สำหรับ where createdAt
  const startOfMonth = moment.tz(TZ).startOf("month").toDate();
  const startOfNextMonth = moment.tz(TZ).add(1, "month").startOf("month").toDate();

  const sequelize = User_token.sequelize;

  const sql = `
    WITH msg_chats AS (
      SELECT
        c.user_id,
        FLOOR(COUNT(m.id) / 2.0)::int AS chats
      FROM message m
      JOIN chat c ON c.id = m.chat_id
      WHERE m."createdAt" >= :start
        AND m."createdAt" <  :end
      GROUP BY c.user_id
    ),
    ut_tokens AS (
      SELECT
        ut.user_id,
        COALESCE(SUM(ut.total_token), 0)::bigint AS tokens
      FROM user_token ut
      WHERE ut."createdAt" >= :start
        AND ut."createdAt" <  :end
      GROUP BY ut.user_id
    )
    SELECT
      mc.user_id,
      COALESCE(u.firstname || ' ' || u.lastname, '-') AS name,
      mc.chats,
      COALESCE(ut.tokens, 0) AS tokens
    FROM msg_chats mc
    LEFT JOIN ut_tokens ut
      ON ut.user_id = mc.user_id
    LEFT JOIN "user" u
      ON u.id = mc.user_id
    ORDER BY COALESCE(ut.tokens, 0) DESC, mc.user_id DESC
    LIMIT 5;
  `;

  const rows = await sequelize.query(sql, {
    replacements: { start: startOfMonth, end: startOfNextMonth },
    type: QueryTypes.SELECT,
  });

  const items = rows.map((r, i) => ({
    rank: i + 1,
    color: RANK_COLORS[i + 1] ?? "#F2F2F2",
    ...r,
  }));

  return items;
};
