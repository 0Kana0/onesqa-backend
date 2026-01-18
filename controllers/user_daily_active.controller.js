// controllers/role.controller.js
const { Op, fn, col, literal, QueryTypes } = require('sequelize');
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { User, User_daily_active } = db;
const moment = require("moment-timezone");

/**
 * แยก DB logic สำหรับ Role ออกมา
 * - สามารถเขียน validation เพิ่มเติม/ธุรกิจลอจิกตรงนี้
 * - ทดสอบแยกหน่วย (unit test) ได้ง่าย
 */

const TZ = 'Asia/Bangkok';
const tzDaySql = `("Message"."createdAt" AT TIME ZONE 'Asia/Bangkok')::date`;
const tzDay = literal(tzDaySql);

moment.tz.setDefault("Asia/Bangkok");

function pad2(n) {
  return String(n).padStart(2, "0");
}

exports.periodUsersActive = async ({ period }) => {
  const tz = "Asia/Bangkok";
  const nowTH = moment.tz(tz);
  const mode = period?.mode ?? "daily";

  // ---------- 1) หา range ตาม mode ----------
  let startTH, endExclTH;

  if (mode === "daily") {
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

  const dialect = User_daily_active.sequelize.getDialect();
  const SPECIAL_ID = "Admin01";

  // ---------- 2) bucketExpr ----------
  let bucketExpr;
  let bucketAlias;

  if (mode === "daily") {
    if (dialect === "postgres") {
      bucketExpr = fn(
        "date_trunc",
        "hour",
        fn("timezone", tz, col("User_daily_active.createdAt"))
      );
      bucketAlias = "bucket";
    } else if (dialect === "mysql") {
      // +07:00 = Bangkok
      bucketExpr = literal(
        `DATE_FORMAT(CONVERT_TZ(User_daily_active.createdAt,'+00:00','+07:00'), '%Y-%m-%d %H:00:00')`
      );
      bucketAlias = "bucket";
    } else {
      bucketExpr = col("User_daily_active.createdAt");
      bucketAlias = "bucket";
    }
  }

  if (mode === "monthly") {
    // weekIndex = floor((day-1)/7)+1 (อิง createdAt ในโซนไทย)
    if (dialect === "postgres") {
      bucketExpr = literal(
        `floor((extract(day from timezone('${tz}', "User_daily_active"."createdAt")) - 1)/7) + 1`
      );
    } else if (dialect === "mysql") {
      bucketExpr = literal(
        `FLOOR((DAY(CONVERT_TZ(User_daily_active.createdAt,'+00:00','+07:00'))-1)/7)+1`
      );
    } else {
      bucketExpr = literal(`1`);
    }
    bucketAlias = "week_index";
  }

  if (mode === "yearly") {
    if (dialect === "postgres") {
      bucketExpr = literal(
        `extract(month from timezone('${tz}', "User_daily_active"."createdAt"))`
      );
    } else if (dialect === "mysql") {
      bucketExpr = literal(
        `MONTH(CONVERT_TZ(User_daily_active.createdAt,'+00:00','+07:00'))`
      );
    } else {
      bucketExpr = literal(`1`);
    }
    bucketAlias = "month_index";
  }

  // ---------- 3) Query: count distinct users ----------
  const where = {
    createdAt: {
      [Op.gte]: startTH.toDate(),
      [Op.lt]: endExclTH.toDate(),
    },
  };

  // COUNT DISTINCT แบบ literal ให้รองรับได้หลาย dialect
  const countDistinctExpr =
    dialect === "postgres"
      ? literal(`COUNT(DISTINCT "User_daily_active"."user_id")`)
      : literal(`COUNT(DISTINCT User_daily_active.user_id)`);

  const rows = await User_daily_active.findAll({
    attributes: [
      [bucketExpr, bucketAlias],
      ["active_type", "active_type"],
      [countDistinctExpr, "value"],
    ],
    include: [
      {
        model: User,
        as: "user",
        attributes: [],
        required: true, // ต้องมี user จริง และใช้ where กรอง Admin01
        where: {
          username: { [Op.ne]: SPECIAL_ID },
        },
      },
    ],
    where,
    group: [bucketExpr, col("User_daily_active.active_type")],
    order: [[bucketExpr, "ASC"], [col("User_daily_active.active_type"), "ASC"]],
    raw: true,
  });

  // ---------- 4) แปลงเป็น events ----------
  const events = rows.map((r) => {
    const model_type = r.active_type ?? "UNKNOWN";
    const value = Number(r.value || 0);

    if (mode === "daily") {
      const ts = moment.tz(r.bucket, tz).format();
      return { ts, model_type, value };
    }

    if (mode === "monthly") {
      const y = Number(period?.year ?? nowTH.year());
      const m = Number(period?.month ?? (nowTH.month() + 1));
      const w = Number(r.week_index); // 1..5
      const startDay = (w - 1) * 7 + 1; // 1,8,15,22,29
      const ts = moment
        .tz(`${y}-${pad2(m)}-${pad2(startDay)}`, "YYYY-MM-DD", tz)
        .startOf("day")
        .format();
      return { ts, model_type, value };
    }

    // yearly
    const y = Number(period?.year ?? nowTH.year());
    const mi = Number(r.month_index); // 1..12
    const ts = moment
      .tz(`${y}-${pad2(mi)}-01`, "YYYY-MM-DD", tz)
      .startOf("day")
      .format();

    return { ts, model_type, value };
  });

  return events;
};
