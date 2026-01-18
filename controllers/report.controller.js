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

function pad2(n) {
  return String(n).padStart(2, "0");
}

exports.listReports = async ({ page, pageSize, where = {} }) => {
  const limit = Math.max(parseInt(pageSize, 10) || 5, 1);
  const p = Math.max(Number(page) || 1, 1);
  const offset = (p - 1) * limit;

  const { startDate, endDate, search } = where || {};
  const TZ = "Asia/Bangkok";

  const normalizeText = (v) => {
    const s = String(v ?? "").replace(/\s+/g, " ").trim();
    return s === "" ? null : s;
  };

  const full = normalizeText(search);
  const q = full ? `%${full}%` : null;

  // --- ช่วงเวลา message ใช้ createdAt แบบ [start, nextDay) โซนไทย ---
  let startParam = null;
  let endParam = null;

  // --- ช่วงเวลา token ใช้ used_date (DATE) ---
  let startDateStr = null;
  let endDateExclStr = null;

  if (startDate) {
    startDateStr = startDate; // "YYYY-MM-DD"
    startParam = moment.tz(startDate, TZ).startOf("day").toDate();
  }

  if (endDate) {
    const endExcl = moment.tz(endDate, TZ).add(1, "day").startOf("day");
    endParam = endExcl.toDate();
    endDateExclStr = endExcl.format("YYYY-MM-DD");
  }

  const sequelize = User_token.sequelize;

  const repl = {
    tz: TZ,
    start: startParam,
    end: endParam,
    startDate: startDateStr,
    endDateExcl: endDateExclStr,
    q,
    limit,
    offset,
  };

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
        ut.used_date::date AS date,
        COALESCE(SUM(ut.total_token), 0)::bigint AS tokens
      FROM user_token ut
      WHERE ut.user_id IS NOT NULL          -- ✅ เพิ่มบรรทัดนี้
        AND (:startDate  IS NULL OR ut.used_date >= :startDate::date)
        AND (:endDateExcl IS NULL OR ut.used_date <  :endDateExcl::date)
      GROUP BY ut.user_id, date
    ),
    combined AS (
      SELECT
        COALESCE(mc.user_id, ut.user_id) AS user_id,
        COALESCE(mc.date, ut.date) AS date,
        COALESCE(mc.chats, 0)::int AS chats,
        COALESCE(ut.tokens, 0)::bigint AS tokens
      FROM msg_chats mc
      FULL OUTER JOIN ut_tokens ut
        ON ut.user_id = mc.user_id
       AND ut.date = mc.date
    )
    SELECT
      ROW_NUMBER() OVER (ORDER BY c.date DESC, c.user_id DESC) AS id,
      c.user_id,
      COALESCE(concat_ws(' ', u.firstname, u.lastname), '-') AS "user",
      u.group_name AS "group",
      c.date AS date,
      c.chats AS chats,
      c.tokens AS tokens
    FROM combined c
    LEFT JOIN "user" u
      ON u.id = c.user_id
    WHERE (
      :q IS NULL OR (
        concat_ws(' ', COALESCE(u.firstname,''), COALESCE(u.lastname,'')) ILIKE :q
        OR COALESCE(u.group_name,'') ILIKE :q
      )
    )
    ORDER BY c.date DESC, c.user_id DESC
    LIMIT :limit OFFSET :offset;
  `;

  const rows = await sequelize.query(itemsSql, {
    replacements: repl,
    type: QueryTypes.SELECT,
  });

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
    ),
    ut_tokens AS (
      SELECT
        ut.user_id,
        ut.used_date::date AS date
      FROM user_token ut
      WHERE ut.user_id IS NOT NULL          -- ✅ เพิ่มบรรทัดนี้
        AND (:startDate  IS NULL OR ut.used_date >= :startDate::date)
        AND (:endDateExcl IS NULL OR ut.used_date <  :endDateExcl::date)
      GROUP BY ut.user_id, date
    ),
    combined AS (
      SELECT
        COALESCE(mc.user_id, ut.user_id) AS user_id,
        COALESCE(mc.date, ut.date) AS date
      FROM msg_chats mc
      FULL OUTER JOIN ut_tokens ut
        ON ut.user_id = mc.user_id
       AND ut.date = mc.date
    )
    SELECT COUNT(*)::int AS cnt
    FROM combined c
    LEFT JOIN "user" u ON u.id = c.user_id
    WHERE (
      :q IS NULL OR (
        concat_ws(' ', COALESCE(u.firstname,''), COALESCE(u.lastname,'')) ILIKE :q
        OR COALESCE(u.group_name,'') ILIKE :q
      )
    );
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

exports.listReportsByPeriod = async ({ page, pageSize, period, where = {}, search }) => {
  const limit = Math.max(parseInt(pageSize, 10) || 5, 1);
  const p = Math.max(Number(page) || 1, 1);
  const offset = (p - 1) * limit;

  const TZ = "Asia/Bangkok";
  const nowTH = moment.tz(TZ);

  const normalizeText = (v) => {
    const s = String(v ?? "").replace(/\s+/g, " ").trim();
    return s === "" ? null : s;
  };

  const full = normalizeText(search ?? where?.search);
  const q = full ? `%${full}%` : null;

  const mode = period?.mode ?? "daily";

  // ---- 1) คำนวณช่วงเวลา (ไทย) [start, end) ----
  let startTH, endExclTH;

  if (mode === "daily") {
    const d = period?.date ? moment.tz(period.date, TZ) : nowTH.clone();
    startTH = d.clone().startOf("day");
    endExclTH = startTH.clone().add(1, "day");
  } else if (mode === "monthly") {
    const y = Number(period?.year ?? nowTH.year());
    const m = Number(period?.month ?? (nowTH.month() + 1));
    startTH = moment.tz(`${y}-${pad2(m)}-01`, "YYYY-MM-DD", TZ).startOf("day");
    endExclTH = startTH.clone().add(1, "month");
  } else {
    const y = Number(period?.year ?? nowTH.year());
    startTH = moment.tz(`${y}-01-01`, "YYYY-MM-DD", TZ).startOf("day");
    endExclTH = startTH.clone().add(1, "year");
  }

  if (startTH.isSameOrAfter(endExclTH)) {
    return { items: [], page: p, pageSize: limit, totalCount: 0 };
  }

  const startParam = startTH.toDate();
  const endParam = endExclTH.toDate();

  const startDateStr = startTH.format("YYYY-MM-DD");
  const endDateExclStr = endExclTH.format("YYYY-MM-DD");

  const sequelize = User_token.sequelize;

  const repl = {
    tz: TZ,
    start: startParam,
    end: endParam,
    startDate: startDateStr,
    endDateExcl: endDateExclStr,
    monthStart: startDateStr,
    year: startTH.year(),
    q,
    limit,
    offset,
  };

  let itemsSql = "";
  let countSql = "";

  // ===================== DAILY =====================
  if (mode === "daily") {
    itemsSql = `
      WITH msg_chats AS (
        SELECT
          c.user_id,
          (m."createdAt" AT TIME ZONE :tz)::date AS d,
          FLOOR(COUNT(m.id) / 2.0)::int AS chats
        FROM message m
        JOIN chat c ON c.id = m.chat_id
        WHERE m."createdAt" >= :start
          AND m."createdAt" <  :end
        GROUP BY c.user_id, d
      ),
      ut_tokens AS (
        SELECT
          ut.user_id,
          ut.used_date::date AS d,
          COALESCE(SUM(ut.total_token), 0)::bigint AS tokens
        FROM user_token ut
        WHERE ut.user_id IS NOT NULL          -- ✅ เพิ่ม
          AND ut.used_date >= :startDate::date
          AND ut.used_date <  :endDateExcl::date
        GROUP BY ut.user_id, d
      ),
      combined AS (
        SELECT
          COALESCE(mc.user_id, ut.user_id) AS user_id,
          COALESCE(mc.d, ut.d) AS period_start,
          COALESCE(mc.chats, 0)::int AS chats,
          COALESCE(ut.tokens, 0)::bigint AS tokens
        FROM msg_chats mc
        FULL OUTER JOIN ut_tokens ut
          ON ut.user_id = mc.user_id
         AND ut.d = mc.d
      )
      SELECT
        ROW_NUMBER() OVER (ORDER BY c.period_start DESC, c.user_id DESC) AS id,
        c.user_id,
        COALESCE(concat_ws(' ', u.firstname, u.lastname), '-') AS "user",
        u.group_name AS "group",
        to_char(c.period_start, 'YYYY-MM-DD') AS period,
        c.period_start AS period_start,
        c.chats AS chats,
        c.tokens AS tokens
      FROM combined c
      LEFT JOIN "user" u ON u.id = c.user_id
      WHERE (
        :q IS NULL OR (
          concat_ws(' ', COALESCE(u.firstname,''), COALESCE(u.lastname,'')) ILIKE :q
          OR COALESCE(u.group_name,'') ILIKE :q
        )
      )
      ORDER BY c.period_start DESC, c.user_id DESC
      LIMIT :limit OFFSET :offset;
    `;

    countSql = `
      WITH msg_chats AS (
        SELECT
          c.user_id,
          (m."createdAt" AT TIME ZONE :tz)::date AS d
        FROM message m
        JOIN chat c ON c.id = m.chat_id
        WHERE m."createdAt" >= :start
          AND m."createdAt" <  :end
        GROUP BY c.user_id, d
      ),
      ut_tokens AS (
        SELECT
          ut.user_id,
          ut.used_date::date AS d
        FROM user_token ut
        WHERE ut.user_id IS NOT NULL          -- ✅ เพิ่ม
          AND ut.used_date >= :startDate::date
          AND ut.used_date <  :endDateExcl::date
        GROUP BY ut.user_id, d
      ),
      combined AS (
        SELECT
          COALESCE(mc.user_id, ut.user_id) AS user_id,
          COALESCE(mc.d, ut.d) AS d
        FROM msg_chats mc
        FULL OUTER JOIN ut_tokens ut
          ON ut.user_id = mc.user_id
         AND ut.d = mc.d
      )
      SELECT COUNT(*)::int AS cnt
      FROM combined c
      LEFT JOIN "user" u ON u.id = c.user_id
      WHERE (
        :q IS NULL OR (
          concat_ws(' ', COALESCE(u.firstname,''), COALESCE(u.lastname,'')) ILIKE :q
          OR COALESCE(u.group_name,'') ILIKE :q
        )
      );
    `;
  }

  // ===================== MONTHLY (WEEKS) =====================
  if (mode === "monthly") {
    itemsSql = `
      WITH meta AS (
        SELECT
          date_trunc('month', :monthStart::date)::date AS month_start,
          extract(day from (date_trunc('month', :monthStart::date) + interval '1 month - 1 day'))::int AS dim
      ),
      msg_week AS (
        SELECT
          c.user_id,
          floor((extract(day from ((m."createdAt" AT TIME ZONE :tz)::date)) - 1)/7) + 1 AS week_index,
          FLOOR(COUNT(m.id) / 2.0)::int AS chats
        FROM message m
        JOIN chat c ON c.id = m.chat_id
        WHERE m."createdAt" >= :start
          AND m."createdAt" <  :end
        GROUP BY c.user_id, week_index
      ),
      ut_week AS (
        SELECT
          ut.user_id,
          floor((extract(day from (ut.used_date::date)) - 1)/7) + 1 AS week_index,
          COALESCE(SUM(ut.total_token), 0)::bigint AS tokens
        FROM user_token ut
        WHERE ut.user_id IS NOT NULL          -- ✅ เพิ่ม
          AND ut.used_date >= :startDate::date
          AND ut.used_date <  :endDateExcl::date
        GROUP BY ut.user_id, week_index
      ),
      combined AS (
        SELECT
          COALESCE(mw.user_id, uw.user_id) AS user_id,
          COALESCE(mw.week_index, uw.week_index)::int AS bucket,
          COALESCE(mw.chats, 0)::int AS chats,
          COALESCE(uw.tokens, 0)::bigint AS tokens
        FROM msg_week mw
        FULL OUTER JOIN ut_week uw
          ON uw.user_id = mw.user_id
         AND uw.week_index = mw.week_index
      )
      SELECT
        ROW_NUMBER() OVER (ORDER BY (meta.month_start + ((c.bucket-1)*7) * interval '1 day') DESC, c.user_id DESC) AS id,
        c.user_id,
        COALESCE(concat_ws(' ', u.firstname, u.lastname), '-') AS "user",
        u.group_name AS "group",
        lpad(((c.bucket-1)*7+1)::text, 2, '0')
          || '-' ||
        lpad(least((c.bucket*7), meta.dim)::text, 2, '0') AS period,
        (meta.month_start + ((c.bucket-1)*7) * interval '1 day')::date AS period_start,
        c.chats AS chats,
        c.tokens AS tokens
      FROM combined c
      CROSS JOIN meta
      LEFT JOIN "user" u ON u.id = c.user_id
      WHERE (
        :q IS NULL OR (
          concat_ws(' ', COALESCE(u.firstname,''), COALESCE(u.lastname,'')) ILIKE :q
          OR COALESCE(u.group_name,'') ILIKE :q
        )
      )
      ORDER BY period_start DESC, c.user_id DESC
      LIMIT :limit OFFSET :offset;
    `;

    countSql = `
      WITH msg_week AS (
        SELECT
          c.user_id,
          floor((extract(day from ((m."createdAt" AT TIME ZONE :tz)::date)) - 1)/7) + 1 AS week_index
        FROM message m
        JOIN chat c ON c.id = m.chat_id
        WHERE m."createdAt" >= :start
          AND m."createdAt" <  :end
        GROUP BY c.user_id, week_index
      ),
      ut_week AS (
        SELECT
          ut.user_id,
          floor((extract(day from (ut.used_date::date)) - 1)/7) + 1 AS week_index
        FROM user_token ut
        WHERE ut.user_id IS NOT NULL          -- ✅ เพิ่ม
          AND ut.used_date >= :startDate::date
          AND ut.used_date <  :endDateExcl::date
        GROUP BY ut.user_id, week_index
      ),
      combined AS (
        SELECT
          COALESCE(mw.user_id, uw.user_id) AS user_id,
          COALESCE(mw.week_index, uw.week_index)::int AS bucket
        FROM msg_week mw
        FULL OUTER JOIN ut_week uw
          ON uw.user_id = mw.user_id
         AND uw.week_index = mw.week_index
      )
      SELECT COUNT(*)::int AS cnt
      FROM combined c
      LEFT JOIN "user" u ON u.id = c.user_id
      WHERE (
        :q IS NULL OR (
          concat_ws(' ', COALESCE(u.firstname,''), COALESCE(u.lastname,'')) ILIKE :q
          OR COALESCE(u.group_name,'') ILIKE :q
        )
      );
    `;
  }

  // ===================== YEARLY (MONTHS) =====================
  if (mode === "yearly") {
    itemsSql = `
      WITH msg_month AS (
        SELECT
          c.user_id,
          extract(month from ((m."createdAt" AT TIME ZONE :tz)::date))::int AS month_index,
          FLOOR(COUNT(m.id) / 2.0)::int AS chats
        FROM message m
        JOIN chat c ON c.id = m.chat_id
        WHERE m."createdAt" >= :start
          AND m."createdAt" <  :end
        GROUP BY c.user_id, month_index
      ),
      ut_month AS (
        SELECT
          ut.user_id,
          extract(month from (ut.used_date::date))::int AS month_index,
          COALESCE(SUM(ut.total_token), 0)::bigint AS tokens
        FROM user_token ut
        WHERE ut.user_id IS NOT NULL          -- ✅ เพิ่ม
          AND ut.used_date >= :startDate::date
          AND ut.used_date <  :endDateExcl::date
        GROUP BY ut.user_id, month_index
      ),
      combined AS (
        SELECT
          COALESCE(mm.user_id, um.user_id) AS user_id,
          COALESCE(mm.month_index, um.month_index)::int AS bucket,
          COALESCE(mm.chats, 0)::int AS chats,
          COALESCE(um.tokens, 0)::bigint AS tokens
        FROM msg_month mm
        FULL OUTER JOIN ut_month um
          ON um.user_id = mm.user_id
         AND um.month_index = mm.month_index
      )
      SELECT
        ROW_NUMBER() OVER (ORDER BY make_date(:year, c.bucket, 1) DESC, c.user_id DESC) AS id,
        c.user_id,
        COALESCE(concat_ws(' ', u.firstname, u.lastname), '-') AS "user",
        u.group_name AS "group",
        to_char(make_date(:year, c.bucket, 1), 'YYYY-MM') AS period,
        make_date(:year, c.bucket, 1) AS period_start,
        c.chats AS chats,
        c.tokens AS tokens
      FROM combined c
      LEFT JOIN "user" u ON u.id = c.user_id
      WHERE (
        :q IS NULL OR (
          concat_ws(' ', COALESCE(u.firstname,''), COALESCE(u.lastname,'')) ILIKE :q
          OR COALESCE(u.group_name,'') ILIKE :q
        )
      )
      ORDER BY period_start DESC, c.user_id DESC
      LIMIT :limit OFFSET :offset;
    `;

    countSql = `
      WITH msg_month AS (
        SELECT
          c.user_id,
          extract(month from ((m."createdAt" AT TIME ZONE :tz)::date))::int AS month_index
        FROM message m
        JOIN chat c ON c.id = m.chat_id
        WHERE m."createdAt" >= :start
          AND m."createdAt" <  :end
        GROUP BY c.user_id, month_index
      ),
      ut_month AS (
        SELECT
          ut.user_id,
          extract(month from (ut.used_date::date))::int AS month_index
        FROM user_token ut
        WHERE ut.user_id IS NOT NULL          -- ✅ เพิ่ม
          AND ut.used_date >= :startDate::date
          AND ut.used_date <  :endDateExcl::date
        GROUP BY ut.user_id, month_index
      ),
      combined AS (
        SELECT
          COALESCE(mm.user_id, um.user_id) AS user_id,
          COALESCE(mm.month_index, um.month_index)::int AS bucket
        FROM msg_month mm
        FULL OUTER JOIN ut_month um
          ON um.user_id = mm.user_id
         AND um.month_index = mm.month_index
      )
      SELECT COUNT(*)::int AS cnt
      FROM combined c
      LEFT JOIN "user" u ON u.id = c.user_id
      WHERE (
        :q IS NULL OR (
          concat_ws(' ', COALESCE(u.firstname,''), COALESCE(u.lastname,'')) ILIKE :q
          OR COALESCE(u.group_name,'') ILIKE :q
        )
      );
    `;
  }

  const rows = await sequelize.query(itemsSql, {
    replacements: repl,
    type: QueryTypes.SELECT,
  });

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

    // ✅ ช่วงเดือนแบบ string (YYYY-MM-DD) เพื่อเทียบกับ used_date (DATE/DATEONLY)
    const startThisMonthStr = moment.tz(TZ).startOf("month").format("YYYY-MM-DD");
    const startNextMonthStr = moment.tz(TZ).startOf("month").add(1, "month").format("YYYY-MM-DD");

    const startLastMonthStr = moment.tz(TZ).startOf("month").subtract(1, "month").format("YYYY-MM-DD");
    const endLastMonthStr = startThisMonthStr; // exclusive

    const normalize = (v) => {
      if (v == null) return 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const [sumThisRaw, sumLastRaw] = await Promise.all([
      User_token.sum("total_token", {
        where: { used_date: { [Op.gte]: startThisMonthStr, [Op.lt]: startNextMonthStr } },
      }).catch(() => 0),

      User_token.sum("total_token", {
        where: { used_date: { [Op.gte]: startLastMonthStr, [Op.lt]: endLastMonthStr } },
      }).catch(() => 0),
    ]);

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
  const activeOnly = false;

  const nowTH = moment.tz(tz);

  // ✅ ช่วงวันแบบไทย (inclusive)
  const startTH = startDate
    ? moment.tz(startDate, "YYYY-MM-DD", tz).startOf("day")
    : nowTH.clone().startOf("day").subtract(29, "days");

  const endTH = endDate
    ? moment.tz(endDate, "YYYY-MM-DD", tz).startOf("day")
    : nowTH.clone().startOf("day");

  // กันกรณี start > end
  if (startTH.isAfter(endTH)) return [];

  // ✅ ใช้ used_date แบบ [start, end+1) เพื่อ query ง่าย
  const startDateStr = startTH.format("YYYY-MM-DD");
  const endDateExclStr = endTH.clone().add(1, "day").format("YYYY-MM-DD");

  // 1) รวม token จาก user_token แยกตามวัน + โมเดล
  const aggRows = await User_token.findAll({
    attributes: [
      [col("User_token.used_date"), "day"],
      [col("ai.model_use_name"), "model"],
      [fn("SUM", col("User_token.total_token")), "total_tokens"],
    ],
    include: [
      {
        model: Ai,
        as: "ai",
        attributes: [],
        required: false, // ai_id null ก็ยังรวมได้ (model จะเป็น null)
      },
    ],
    where: {
      used_date: {
        [Op.gte]: startDateStr,
        [Op.lt]: endDateExclStr,
      },
    },
    group: [col("User_token.used_date"), col("ai.model_use_name")],
    order: [[col("User_token.used_date"), "ASC"], [col("ai.model_use_name"), "ASC"]],
    raw: true,
  });

  // Map key = `${YYYY-MM-DD}|${model}`
  const aggMap = new Map();
  const seenModels = new Set();

  for (const r of aggRows) {
    const d = String(r.day); // DATEONLY มักได้เป็น "YYYY-MM-DD"
    const m = r.model ?? "UNKNOWN";
    seenModels.add(m);
    aggMap.set(`${d}|${m}`, Number(r.total_tokens || 0));
  }

  // 2) โหลดรายชื่อโมเดลทั้งหมด (และเสริม UNKNOWN ถ้ามี)
  const aiWhere = activeOnly ? { activity: true } : {};
  const aiList = await Ai.findAll({
    attributes: ["model_use_name"],
    where: aiWhere,
    raw: true,
  });

  const models = aiList.map((a) => a.model_use_name).filter(Boolean);
  if (seenModels.has("UNKNOWN") && !models.includes("UNKNOWN")) models.push("UNKNOWN");
  models.sort();

  if (models.length === 0) return [];

  // 3) สร้างอาร์เรย์วัน (ไทย) แบบ inclusive
  const days = [];
  for (let cur = startTH.clone(); cur.isSameOrBefore(endTH); cur.add(1, "day")) {
    days.push(cur.format("YYYY-MM-DD"));
  }

  // 4) เติมให้ครบ วัน × โมเดล
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

exports.PeriodChartReports = async ({ period }) => {
  const tz = "Asia/Bangkok";
  const nowTH = moment.tz(tz);

  const mode = period?.mode ?? "daily";

  // ---------- 1) หา range ตาม mode ----------
  let startTH, endExclTH;

  if (mode === "daily") {
    // ✅ period.date เป็น DateTime ก็ parse ได้เลย (ไม่ fix "YYYY-MM-DD")
    const d = period?.date ? moment.tz(period.date, tz) : nowTH.clone();
    startTH = d.clone().startOf("day");
    endExclTH = startTH.clone().add(1, "day");
  } else if (mode === "monthly") {
    const y = Number(period?.year ?? nowTH.year());
    const m = Number(period?.month ?? (nowTH.month() + 1));
    startTH = moment.tz(`${y}-${pad2(m)}-01`, "YYYY-MM-DD", tz).startOf("day");
    endExclTH = startTH.clone().add(1, "month");
  } else {
    const y = Number(period?.year ?? nowTH.year());
    startTH = moment.tz(`${y}-01-01`, "YYYY-MM-DD", tz).startOf("day");
    endExclTH = startTH.clone().add(1, "year");
  }

  if (startTH.isSameOrAfter(endExclTH)) return [];

  const dialect = User_token.sequelize.getDialect();
  const usedDateStr = startTH.format("YYYY-MM-DD");
  const usedDateExclStr = endExclTH.format("YYYY-MM-DD");

  // ---------- 2) สร้าง bucketExpr ให้ถูก แล้วเอาไปใช้ใน group/order ----------
  let bucketExpr;
  let bucketAlias;

  if (mode === "daily") {
    // ✅ รายวันต้องใช้ฟิลด์มีเวลา (createdAt)
    if (dialect === "postgres") {
      bucketExpr = fn(
        "date_trunc",
        "hour",
        fn("timezone", tz, col("User_token.createdAt"))
      );
      bucketAlias = "bucket";
    } else if (dialect === "mysql") {
      bucketExpr = literal(
        `DATE_FORMAT(CONVERT_TZ(User_token.createdAt,'+00:00','+07:00'), '%Y-%m-%d %H:00:00')`
      );
      bucketAlias = "bucket";
    } else {
      bucketExpr = col("User_token.createdAt");
      bucketAlias = "bucket";
    }
  }

  if (mode === "monthly") {
    // ✅ weekIndex = floor((day-1)/7)+1
    if (dialect === "postgres") {
      bucketExpr = literal(
        `floor((extract(day from "User_token"."used_date") - 1)/7) + 1`
      );
    } else {
      bucketExpr = literal(`FLOOR((DAY(User_token.used_date)-1)/7)+1`);
    }
    bucketAlias = "week_index";
  }

  if (mode === "yearly") {
    if (dialect === "postgres") {
      bucketExpr = literal(`extract(month from "User_token"."used_date")`);
    } else {
      bucketExpr = literal(`MONTH(User_token.used_date)`);
    }
    bucketAlias = "month_index";
  }

  // ---------- 3) Query รวม token ----------
  const where = {
    used_date: {
      [Op.gte]: usedDateStr,
      [Op.lt]: usedDateExclStr,
    },
  };

  // ✅ รายวัน: คุมช่วงด้วย createdAt ด้วย (กันหลุดวัน)
  if (mode === "daily") {
    where.createdAt = {
      [Op.gte]: startTH.toDate(),
      [Op.lt]: endExclTH.toDate(),
    };
  }

  const aggRows = await User_token.findAll({
    attributes: [
      [bucketExpr, bucketAlias],
      [col("ai.model_type"), "model_type"],
      [fn("SUM", col("User_token.total_token")), "value"],
    ],
    include: [
      {
        model: Ai,
        as: "ai",
        attributes: [],
        required: false,
      },
    ],
    where,
    // ✅ ใช้ bucketExpr ตัวเดียวกันใน group/order
    group: [bucketExpr, col("ai.model_type")],
    order: [[bucketExpr, "ASC"], [col("ai.model_type"), "ASC"]],
    raw: true,
  });

  // ---------- 4) แปลงเป็น events สำหรับ PeriodReportChart ----------
  const events = aggRows.map((r) => {
    const model_type = r.model_type ?? "UNKNOWN";
    const value = Number(r.value || 0);

    if (mode === "daily") {
      const ts = moment.tz(r.bucket, tz).format(); // 2026-01-08T10:00:00+07:00
      return { ts, model_type, value };
    }

    if (mode === "monthly") {
      const y = Number(period.year);
      const m = Number(period.month);
      const w = Number(r.week_index); // 1..5
      const startDay = (w - 1) * 7 + 1; // 1,8,15,22,29
      const ts = moment
        .tz(`${y}-${pad2(m)}-${pad2(startDay)}`, "YYYY-MM-DD", tz)
        .startOf("day")
        .format();
      return { ts, model_type, value };
    }

    // yearly
    const y = Number(period.year);
    const mi = Number(r.month_index); // 1..12
    const ts = moment
      .tz(`${y}-${pad2(mi)}-01`, "YYYY-MM-DD", tz)
      .startOf("day")
      .format();

    return { ts, model_type, value };
  });

  return events;
};

exports.TopFiveReports = async () => {
  const TZ = "Asia/Bangkok";

  const startOfMonthStr = moment.tz(TZ).startOf("month").format("YYYY-MM-DD");
  const startOfNextMonthStr = moment
    .tz(TZ)
    .startOf("month")
    .add(1, "month")
    .format("YYYY-MM-DD");

  const startOfMonth = moment.tz(TZ).startOf("month").toDate();
  const startOfNextMonth = moment.tz(TZ).startOf("month").add(1, "month").toDate();

  const sequelize = User_token.sequelize;

  const sql = `
    WITH ut_tokens AS (
      SELECT
        ut.user_id,
        COALESCE(SUM(ut.total_token), 0)::bigint AS tokens
      FROM user_token ut
      WHERE ut.user_id IS NOT NULL              -- ✅ เพิ่มบรรทัดนี้
        AND ut.used_date >= :tokStart::date
        AND ut.used_date <  :tokEnd::date
      GROUP BY ut.user_id
    ),
    msg_chats AS (
      SELECT
        c.user_id,
        FLOOR(COUNT(m.id) / 2.0)::int AS chats
      FROM message m
      JOIN chat c ON c.id = m.chat_id
      WHERE m."createdAt" >= :msgStart
        AND m."createdAt" <  :msgEnd
      GROUP BY c.user_id
    )
    SELECT
      ut.user_id,
      COALESCE(u.firstname || ' ' || u.lastname, '-') AS name,
      COALESCE(mc.chats, 0) AS chats,
      ut.tokens AS tokens
    FROM ut_tokens ut
    LEFT JOIN msg_chats mc
      ON mc.user_id = ut.user_id
    LEFT JOIN "user" u
      ON u.id = ut.user_id
    ORDER BY ut.tokens DESC, ut.user_id DESC
    LIMIT 5;
  `;

  const rows = await sequelize.query(sql, {
    replacements: {
      msgStart: startOfMonth,
      msgEnd: startOfNextMonth,
      tokStart: startOfMonthStr,
      tokEnd: startOfNextMonthStr,
    },
    type: QueryTypes.SELECT,
  });

  return rows.map((r, i) => ({
    rank: i + 1,
    color: RANK_COLORS[i + 1] ?? "#F2F2F2",
    ...r,
  }));
};
