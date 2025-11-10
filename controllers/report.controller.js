// controllers/role.controller.js
const { Op, fn, col, literal, QueryTypes } = require('sequelize');
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Chat, Message, User, Ai } = db;
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
  const limit = Math.min(Math.max(Number(pageSize) || 5, 1), 100);
  const p = Math.max(Number(page) || 1, 1);
  const offset = (p - 1) * limit;

  const { startDate, endDate } = where || {};

  // --- สร้างช่วงเวลาแบบ [start, nextDay) ในโซนเวลาไทย ---
  // --- ช่วงเวลาแบบ [start, nextDay) โซนไทย ---
  const whereClause = {};
  let startParam = null;
  let endParam = null;
  if (startDate) startParam = new Date(`${startDate}T00:00:00.000+07:00`);
  if (endDate) {
    const nextDay = new Date(`${endDate}T00:00:00.000+07:00`);
    nextDay.setDate(nextDay.getDate() + 1); // exclusive
    endParam = nextDay;
  }
  if (startParam || endParam) {
    whereClause.createdAt = {};
    if (startParam) whereClause.createdAt[Op.gte] = startParam;
    if (endParam) whereClause.createdAt[Op.lt] = endParam;
  }

  const rows = await Message.findAll({
    attributes: [
      // ✅ เลขลำดับต่อเนื่องตามลำดับเรียงผลลัพธ์
      [literal(`ROW_NUMBER() OVER (ORDER BY ${tzDaySql} DESC, "chat"."user_id" DESC)`), 'id'],
      [col('chat.user_id'), 'user_id'],
      // เอา fullname = firstname + ' ' + lastname
      [
        fn('MIN', literal(`"chat->user"."firstname" || ' ' || "chat->user"."lastname"`)),
        'user'
      ],
      [fn('MIN', col('chat->user.position')), 'position'],
      [tzDay, 'date'],
      [literal(`FLOOR(COUNT("Message"."id") / 2.0)::int`), 'chats'],
      [fn('COALESCE', fn('SUM', col('Message.total_token')), 0), 'tokens'],
    ],
    include: [
      {
        model: Chat,
        as: 'chat',
        attributes: [],
        required: true,
        include: [{ model: User, as: 'user', attributes: [] }],
      },
    ],
    group: [col('chat.user_id'), tzDay],
    order: [[tzDay, 'DESC'], [col('chat.user_id'), 'DESC']],
    where: whereClause,
    limit,
    offset,
    raw: true,
  });

  // --- totalCount = จำนวนกลุ่มทั้งหมดหลัง group (user_id + day) ---
  const sequelize = Message.sequelize;
  const tzDaySqlCount = `("m"."createdAt" AT TIME ZONE '${TZ}')::date`;
  const whereParts = [];
  const repl = {};

  if (startParam) { whereParts.push(`m."createdAt" >= :start`); repl.start = startParam; }
  if (endParam)   { whereParts.push(`m."createdAt" <  :end`);   repl.end   = endParam; }
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const countSql = `
    SELECT COUNT(*)::int AS cnt
    FROM (
      SELECT c.user_id, ${tzDaySqlCount} AS date
      FROM message m
      JOIN chat c ON c.id = m.chat_id
      ${whereSql}
      GROUP BY c.user_id, date
    ) t;
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

    // ถ้าเดือนที่แล้วเป็น 0 → ตั้งเป็น null (เลี่ยงหารศูนย์)
    const percentChange = lastMonth === 0 ? 0 : Math.round((diff / lastMonth) * 100);

    return {
      value: Math.floor(thisMonth / 2), // ตาม logic เดิมของคุณ
      percentChange,
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
    const TZ = 'Asia/Bangkok';
    const startThisMonth = moment.tz(TZ).startOf('month').toDate();
    const endThisMonth   = moment(startThisMonth).add(1, 'month').toDate();

    const startLastMonth = moment(startThisMonth).subtract(1, 'month').toDate();
    const endLastMonth   = startThisMonth;

    // กันกรณี sum โยน error → ให้เป็น 0
    const [sumThisRaw, sumLastRaw] = await Promise.all([
      Message.sum('total_token', {
        where: { createdAt: { [Op.gte]: startThisMonth, [Op.lt]: endThisMonth } },
      }).catch(() => 0),
      Message.sum('total_token', {
        where: { createdAt: { [Op.gte]: startLastMonth, [Op.lt]: endLastMonth } },
      }).catch(() => 0),
    ]);

    // แปลงค่าให้เป็น number เสมอ (รองรับ DECIMAL ที่ Sequelize อาจให้มาเป็น string)
    const normalize = (v) => {
      if (v == null) return 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const thisMonth = normalize(sumThisRaw);
    const lastMonth = normalize(sumLastRaw);

    const diff = thisMonth - lastMonth;
    const percentChange = lastMonth === 0 ? 0 : Math.round((diff / lastMonth) * 100);

    return {
      value: thisMonth,   // ผลรวม token เดือนนี้
      percentChange,
    };
  } catch (e) {
    // กันทุกกรณีที่นอกเหนือจาก query (เช่น import/Op/moment มีปัญหา)
    return {
      value: 0,
      percentChange: 0,
    };
  }
};

exports.ChartReports = async ({ startDate, endDate  }) => {
  const tz = 'Asia/Bangkok'
  const createdAtMode = 'auto'
  const activeOnly = false

  // 1) สร้างช่วงเวลาไทย [start 00:00(+07), end(+1) 00:00(+07)) แล้วแปลงเป็น UTC สำหรับ where
  const nowTH = moment.tz(tz);

  const startTH = startDate
    ? moment.tz(`${startDate} 00:00:00`, 'YYYY-MM-DD HH:mm:ss', tz)
    : nowTH.clone().startOf('day').subtract(29, 'days');

  const endTHExclusive = endDate
    ? moment.tz(`${endDate} 00:00:00`, 'YYYY-MM-DD HH:mm:ss', tz).add(1, 'day')
    : nowTH.clone().endOf('day').add(1, 'millisecond'); // ครอบคลุมถึงสิ้นวันนี้

  const startUTC = startTH.clone().tz('UTC');
  const endUTC   = endTHExclusive.clone().tz('UTC');

  const whereClause = {
    createdAt: {
      [Op.gte]: startUTC.toDate(),
      [Op.lt]:  endUTC.toDate(),
    },
  };

  // ===== 2) นิพจน์ตัดวันตามเวลาไทยไว้ group =====
  const dayExpr =
    createdAtMode === 'timestamp'
      ? `DATE_TRUNC('day', ("Message"."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE '${tz}'))`
      : `DATE_TRUNC('day', ("Message"."createdAt" AT TIME ZONE '${tz}'))`;

  // ===== 3) คิวรีรวมจริง (อาจได้ไม่ครบทุกโมเดลในทุกวัน) =====
  const aggRows = await Message.findAll({
    attributes: [
      [literal(dayExpr), 'day_th'],
      [literal(`"chat->ai"."model_use_name"`), 'model'],
      [fn('SUM', col('Message.total_token')), 'total_tokens'],
    ],
    include: [{
      model: Chat,
      as: 'chat',
      attributes: [],
      include: [{ model: Ai, as: 'ai', attributes: [] }],
    }],
    where: whereClause,
    group: [literal(dayExpr), literal(`"chat->ai"."model_use_name"`)],
    order: [[literal('day_th'), 'ASC'], [literal(`"chat->ai"."model_use_name"`), 'ASC']],
    raw: true,
  });

  // แปลงเป็น Map key = `${YYYY-MM-DD}|${model}`
  const aggMap = new Map();
  for (const r of aggRows) {
    const d = moment.tz(r.day_th, tz).format('YYYY-MM-DD');
    const k = `${d}|${r.model}`;
    aggMap.set(k, Number(r.total_tokens || 0));
  }

  // ===== 4) โหลดรายชื่อโมเดลทั้งหมด =====
  const aiWhere = activeOnly ? { activity: true } : {};
  const aiList = await Ai.findAll({
    attributes: ['model_use_name'],
    where: aiWhere,
    raw: true,
  });
  const models = aiList.map(a => a.model_use_name).sort();

  // ถ้าไม่มีโมเดลเลย ก็ตัดจบ
  if (models.length === 0) return [];

  // ===== 5) สร้างอาร์เรย์วันตั้งแต่ start ถึง end-1day (ไทย) =====
  const days = [];
  for (let cur = startTH.clone(); cur.isBefore(endTHExclusive); cur.add(1, 'day')) {
    days.push(cur.format('YYYY-MM-DD'));
  }

  // ===== 6) เติมผลให้ครบ วัน × โมเดล (ถ้าไม่มี ให้ 0) =====
  const dense = [];
  for (const d of days) {
    for (const m of models) {
      const k = `${d}|${m}`;
      dense.push({
        date: d,
        model: m,
        total_tokens: aggMap.get(k) ?? 0,
      });
    }
  }

  //console.log(dense);

  return dense; // เรียงตามวันก่อน แล้วค่อยเรียงตามชื่อโมเดล
}

exports.TopFiveReports = async () => {
  // เริ่มเดือนนี้และต้นเดือนถัดไป ในโซนเวลาไทย
  const startOfMonth = moment.tz(TZ).startOf('month').toDate();
  const startOfNextMonth = moment.tz(TZ).add(1, 'month').startOf('month').toDate();

  const rows = await Message.findAll({
    attributes: [
      [col('chat.user_id'), 'user_id'],
      [
        fn(
          'MIN',
          literal(`"chat->user"."firstname" || ' ' || "chat->user"."lastname"`)
        ),
        'name'
      ],
      [literal(`FLOOR(COUNT("Message"."id") / 2.0)::int`), 'chats'],
      [fn('COALESCE', fn('SUM', col('Message.total_token')), 0), 'tokens'],
    ],
    include: [
      {
        model: Chat,
        as: 'chat',
        attributes: [],
        required: true,
        include: [{ model: User, as: 'user', attributes: [] }],
      },
    ],
    // เฉพาะข้อมูลในเดือนปัจจุบันตามโซนเวลาไทย
    where: {
      createdAt: {
        [Op.gte]: startOfMonth,      // >= ต้นเดือนนี้ (ตาม TZ)
        [Op.lt]: startOfNextMonth,   // < ต้นเดือนถัดไป (ตาม TZ)
      },
    },
    group: [col('chat.user_id')],
    order: [
      // เรียงตามผลรวม token มาก -> น้อย
      [fn('COALESCE', fn('SUM', col('Message.total_token')), 0), 'DESC'],
      [col('chat.user_id'), 'DESC'], // กันกรณีคะแนนเท่ากัน
    ],
    limit: 5,   // เอา 5 คนแรก
    raw: true,
  });

  // (ถ้าอยากมีลำดับ 1-5)
  const items = rows.map((r, i) => ({ 
    rank: i + 1, 
    color: RANK_COLORS[i+1] ?? '#F2F2F2',
    ...r, 
  }));

  console.log(items);
  
  // ไม่มี pagination ตามที่ขอ
  return items;
}