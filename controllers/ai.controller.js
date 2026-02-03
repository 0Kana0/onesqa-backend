// controllers/ai.controller.js
const { Op, fn, col } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Ai, Chat, Message, User, User_role, User_ai, Group, Group_ai, User_token, sequelize } = db;
const { auditLog } = require('../utils/auditLog'); // ปรับ path ให้ตรง
const { notifyUser } = require("../utils/notifier"); // ที่ไฟล์ service/controller ของคุณ
const { getLocale, getCurrentUser } = require("../utils/currentUser");
const moment = require('moment-timezone');

/**
 * แยก DB logic สำหรับ Ai ออกมา
 * - สามารถเขียน validation เพิ่มเติม/ธุรกิจลอจิกตรงนี้
 * - ทดสอบแยกหน่วย (unit test) ได้ง่าย
 */
const TZ = 'Asia/Bangkok';

exports.listAis = async (message_type) => {
  // ขอบเขตเวลาโซนไทย
  const nowTH = moment.tz(TZ);
  const startMonthTH = nowTH.clone().startOf("month");

  const usedDateToday = nowTH.format("YYYY-MM-DD");
  const startOfMonthStr = startMonthTH.format("YYYY-MM-DD");
  const startOfNextMonthStr = startMonthTH.clone().add(1, "month").format("YYYY-MM-DD");

  const daysElapsed = nowTH.diff(startMonthTH, "days") + 1;

  // ---- message_type filter (optional) ----
  const ALLOWED = new Set(["TEXT", "IMAGE", "VIDEO", "DOC"]);

  const normalizeMessageType = (v) => {
    if (!v) return null;

    // array: ["TEXT","IMAGE"]
    if (Array.isArray(v)) {
      const arr = v
        .map((x) => String(x || "").trim().toUpperCase())
        .filter(Boolean)
        .filter((x) => ALLOWED.has(x));
      return arr.length ? arr : null;
    }

    // string: "TEXT" or "TEXT,IMAGE"
    const s = String(v).trim();
    if (!s) return null;

    const arr = s
      .split(",")
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean)
      .filter((x) => ALLOWED.has(x));

    return arr.length ? arr : null;
  };

  const mt = normalizeMessageType(message_type);

  const aiWhere = {};
  if (mt) {
    aiWhere.message_type = mt.length === 1 ? mt[0] : { [Op.in]: mt };
  }

  // 1) รายการ Ai (+ filter ตาม message_type ถ้ามี)
  const ais = await Ai.findAll({
    where: aiWhere,
    order: [["id", "ASC"]],
    raw: true,
  });

  // ถ้าไม่มี ai ที่ match ก็จบเลย (กัน query user_token เปลือง)
  if (!ais.length) return [];

  const aiIds = ais.map((a) => a.id);

  // base where สำหรับ token: จำกัดเฉพาะ ai ที่ได้มาแล้ว
  const tokenBaseWhere = {
    ai_id: { [Op.in]: aiIds },
  };

  // 2) รวม token "วันนี้" ต่อ Ai จาก user_token
  const todayAgg = await User_token.findAll({
    attributes: [
      ["ai_id", "ai_id"],
      [fn("COALESCE", fn("SUM", col("total_token")), 0), "tokens_today"],
    ],
    where: {
      ...tokenBaseWhere,
      used_date: usedDateToday,
    },
    group: ["ai_id"],
    raw: true,
  });

  // 3) รวม token "เดือนนี้" ต่อ Ai จาก user_token (ไว้หาเฉลี่ยต่อวัน)
  const monthAgg = await User_token.findAll({
    attributes: [
      ["ai_id", "ai_id"],
      [fn("COALESCE", fn("SUM", col("total_token")), 0), "tokens_month"],
    ],
    where: {
      ...tokenBaseWhere,
      used_date: { [Op.gte]: startOfMonthStr, [Op.lt]: startOfNextMonthStr },
    },
    group: ["ai_id"],
    raw: true,
  });

  // 4) ทำเป็น map เพื่อ join กลับเข้า ais
  const todayMap = new Map(
    todayAgg.map((r) => [String(r.ai_id), Number(r.tokens_today) || 0])
  );
  const monthMap = new Map(
    monthAgg.map((r) => [String(r.ai_id), Number(r.tokens_month) || 0])
  );

  // 5) คืนผล พร้อมฟิลด์ today และ average
  return ais.map((item) => {
    const tokensToday = todayMap.get(String(item.id)) ?? 0;
    const tokensMonth = monthMap.get(String(item.id)) ?? 0;
    const averageDay = daysElapsed > 0 ? Math.round(tokensMonth / daysElapsed) : 0;

    return {
      ...item,
      today: tokensToday,
      average: averageDay,
    };
  });
};

exports.getAiById = async (id) => {
  return await Ai.findByPk(id);
}

exports.sumTokenCountByModel = async () => {
  const sql = `
    SELECT
      ua.ai_id,
      a.model_name,
      a.model_use_name,
      a.model_type,
      a.message_type,

      COALESCE(a.token_count, 0) AS ai_token_count,

      SUM(COALESCE(ua.token_count, 0)) AS total_token_count,
      SUM(COALESCE(ua.token_all, 0))   AS total_token_all,
      COUNT(DISTINCT ua.user_id)       AS user_count,

      -- ✅ ผลต่าง (ai.token_count - ผลรวม user_ai.token_count)
      (COALESCE(a.token_count, 0) - SUM(COALESCE(ua.token_count, 0))) AS diff_token_count

    FROM user_ai ua
    INNER JOIN ai a ON a.id = ua.ai_id
    GROUP BY
      ua.ai_id,
      a.model_name,
      a.model_use_name,
      a.model_type,
      a.message_type,
      a.token_count
    ORDER BY total_token_count DESC
  `;

  const [rows] = await sequelize.query(sql);
  console.log(rows);
  return rows;
};

/**
 * สร้าง Ai ใหม่ + map ไปยัง User_ai และ Group_ai ให้ทุก user / group
 */
exports.createAi = async (input, ctx) => {
  // ใช้ transaction เพื่อให้ทุกอย่างสำเร็จหรือพังพร้อมกัน
  return await db.sequelize.transaction(async (t) => {

    const locale = await getLocale(ctx);

    // 1) validation เดิม
    if (input.token_count < 0) {
      throw new Error(locale === "th" ? "token_count ต้องมากกว่า 0" : "token_count must be greater than 0");
    }
    if (input.token_all < 0) {
      throw new Error(locale === "th" ? "token_all ต้องมากกว่า 0" : "token_all must be greater than 0");
    }

    // ชื่อ model ห้ามซ้ำ
    const exists = await Ai.findOne({
      where: { model_name: input.model_name },
      transaction: t,
    });
    if (exists) throw new Error(locale === "th" ? "มี model_name นี้อยู่แล้ว" : "model_name already exists");

    // 2) สร้าง Ai ใหม่
    const ai = await Ai.create(input, { transaction: t });

    // 3) ดึง user ทั้งหมด แล้วสร้าง User_ai ให้ทุกคน
    const users = await User.findAll({
      attributes: ["id"],
      transaction: t,
    });

    if (users.length > 0) {
      const now = new Date();
      const userAiRows = users.map((u) => ({
        user_id: u.id,
        ai_id: ai.id,
        token_count: 0,      // ค่าเริ่มต้น ปรับได้ตาม schema จริง
        token_all: 0,      // ค่าเริ่มต้น ปรับได้ตาม schema จริง
        is_notification: false,      // ค่าเริ่มต้น ปรับได้ตาม schema จริง
        createdAt: now,
        updatedAt: now,
      }));

      await User_ai.bulkCreate(userAiRows, { transaction: t });
    }

    // 4) ดึง group ทั้งหมด แล้วสร้าง Group_ai ให้ทุก group
    const groups = await Group.findAll({
      attributes: ["id"],
      transaction: t,
    });

    if (groups.length > 0) {
      const now = new Date();
      const groupAiRows = groups.map((g) => ({
        group_id: g.id,
        ai_id: ai.id,
        init_token: 0,      // ค่าเริ่มต้น ปรับได้ตาม schema จริง
        createdAt: now,
        updatedAt: now,
      }));

      await Group_ai.bulkCreate(groupAiRows, { transaction: t });
    }

    // ส่ง Ai ที่สร้างกลับไป
    return ai;
  });
};

exports.updateAi = async (id, input, ctx) => {

  const locale = await getLocale(ctx);

  const row = await Ai.findByPk(id);
  if (!row) throw new Error(locale === "th" ? "ไม่พบข้อมูล AI" : "AI not found");

  // ✅ validate ค่า token
  if (input?.token_count != null && input.token_count < 0) {
    throw new Error(locale === "th" ? "token_count ต้องมากกว่า 0" : "token_count must be greater than 0");
  }
  if (input?.token_all != null && input.token_all < 0) {
    throw new Error(locale === "th" ? "token_all ต้องมากกว่า 0" : "token_all must be greater than 0");
  }

  //✅ ไม่ให้ลด token ลง
  if (input?.token_count != null && input.token_count < row.token_count) {
    throw new Error(
      locale === "th"
        ? "จำนวน token ไม่สามารถแก้ไขให้ลดลงได้ เนื่องจากต้องไปปรับจำนวนเงินในบัญชี"
        : "Token amounts cannot be reduced, as this would require adjusting the account balance"
    );
  }

  console.log("row", row);
  console.log("input", input);

  // flag เอาไว้เช็คว่ามีการเปลี่ยนไหม
  let shouldResetNotification = false;

  const isStatusChanged =
    input?.activity !== undefined && row.activity !== input.activity;

  const isTokenChanged =
    input?.token_count !== undefined && Number(row.token_count) !== Number(input.token_count);

  //ถ้ามีการเปลี่ยนเเปลงสถานะ ให้ทำการเก็บ log ไว้
  if (isStatusChanged) {
    const th_message = `กำหนด AI Access (${row.model_use_name})`;
    const en_message = `Set AI Access (${row.model_use_name})`;

    // ภาษาไทย
    await auditLog({
      ctx,
      locale: "th",
      log_type: 'MODEL',
      old_data: th_message,
      new_data: th_message,
      old_status: row.activity,
      new_status: input?.activity,
    });

    // ภาษาอังกฤษ
    await auditLog({
      ctx,
      locale: "en",
      log_type: 'MODEL',
      old_data: en_message,
      new_data: en_message,
      old_status: row.activity,
      new_status: input?.activity,
    });

    const toBool = (val) => {
      if (typeof val === "string")
        return ["true", "1", "yes", "y"].includes(val.toLowerCase());
      if (typeof val === "number") return val === 1;
      return !!val;
    };

    const thLabel = (val) => (toBool(val) ? "อนุมัติ" : "ไม่อนุมัติ");
    const enLabel = (val) => (toBool(val) ? "Active" : "Inactive");

    // เเจ้งเตือน user ทั้งหมด
    const allUsers = await User.findAll({
      attributes: ["id", "email", "locale", "loginAt"],
    });

    for (const all of allUsers) {
      // ภาษาไทย
      await notifyUser({
        locale: "th",
        recipient_locale: all.locale,
        loginAt: all.loginAt,
        userId: all.id,
        title: "เเจ้งเตือนตั้งค่า Model ของระบบ",
        message: `กำหนด AI Activity ของ Model (${row.model_use_name}) จาก ${thLabel(
          row.activity
        )} เป็น ${thLabel(input?.activity)}`,
        type: "INFO",
        to: all.email,
      });

      // ภาษาอังกฤษ (ใช้ Active / Inactive)
      await notifyUser({
        locale: "en",
        recipient_locale: all.locale,
        loginAt: all.loginAt,
        userId: all.id,
        title: "System Model Settings Notification",
        message: `AI Activity for model (${row.model_use_name}) has been changed from ${enLabel(
          row.activity
        )} to ${enLabel(input?.activity)}.`,
        type: "INFO",
        to: all.email,
      });
    }
  }

  //ถ้ามีการเปลี่ยนเเปลงจำนวน token ให้ทำการเก็บ log ไว้ + reset is_notification
  if (isTokenChanged) {
    const th_old_message = `จำนวน Token ของ Model (${row.model_use_name}) ${row.token_count.toLocaleString()}`;
    const th_new_message = `จำนวน Token ของ Model (${row.model_use_name}) ${input.token_count.toLocaleString()}`;

    const en_old_message = `Token count for model (${row.model_use_name}) ${row.token_count.toLocaleString()}`;
    const en_new_message = `Token count for model (${row.model_use_name}) ${input.token_count.toLocaleString()}`;

    // ภาษาไทย
    await auditLog({
      ctx,
      locale: "th",
      log_type: 'MODEL',
      old_data: th_old_message,
      new_data: th_new_message,
      old_status: null,
      new_status: null,
    });

    // ภาษาอังกฤษ
    await auditLog({
      ctx,
      locale: "en",
      log_type: 'MODEL',
      old_data: en_old_message,
      new_data: en_new_message,
      old_status: null,
      new_status: null,
    });

    // เเจ้งเตือนเฉพาะ admin
    const adminUsers = await User.findAll({
      attributes: ["id", "email", "locale", "loginAt"],
      include: [
        {
          model: User_role,
          as: "user_role",
          where: { 
            role_id: { [Op.in]: [3, 4] }   // role_id = 3 หรือ 4
          },
          attributes: [],
        },
      ],
    });
    for (const admin of adminUsers) {
      // ภาษาไทย
      await notifyUser({
        locale: "th",
        recipient_locale: admin.locale,
        loginAt: admin.loginAt,
        userId: admin.id,
        title: "เเจ้งเตือนตั้งค่า Model ของระบบ",
        message: `จำนวน Token ของ Model (${row.model_use_name}) จาก ${row.token_count.toLocaleString()} เป็น ${input.token_count.toLocaleString()}`,
        type: "INFO",
        to: admin.email,
      });

      // ภาษาอังกฤษ
      await notifyUser({
        locale: "en",
        recipient_locale: admin.locale,
        loginAt: admin.loginAt,
        userId: admin.id,
        title: "System Model Settings Notification",
        message: `Token count for model (${row.model_use_name}) has been changed from ${row.token_count.toLocaleString()} to ${input.token_count.toLocaleString()}.`,
        type: "INFO",
        to: admin.email,
      });
    }

    // ✅ มีการเปลี่ยน token → ให้ reset is_notification
    shouldResetNotification = true;
  }

  // ❗ ถ้าไม่มีการเปลี่ยนแปลงสถานะ และไม่มีการเปลี่ยนแปลงจำนวน token
  //    → ไม่ต้องบันทึกลง DB
  if (!isStatusChanged && !isTokenChanged) {
    // จะ return row เฉย ๆ หรือจะ throw Error แจ้งก็ได้แล้วแต่ requirement
    // throw new Error('ไม่มีการเปลี่ยนแปลงสถานะหรือจำนวน token');
    return row;
  }

  // สร้าง payload สำหรับ update (อัปเดตเฉพาะเมื่อมีการเปลี่ยน status/token อย่างน้อย 1 อย่าง)
  const updatePayload = {
    ...input,
    ...(shouldResetNotification && { is_notification: false }), // ใส่เฉพาะตอน token เปลี่ยน
  };

  await row.update(updatePayload);
  return row;
};

exports.deleteAi = async (id) => {
  const count = await Ai.destroy({ where: { id } });
  return count > 0;
}
