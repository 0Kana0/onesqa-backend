// controllers/user.controller.js
const axios = require("axios");
require("dotenv").config();
const { Op, fn, col, where } = require("sequelize");
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { User, User_role, User_ai, Role, Ai, Chat, Message, Group, Group_ai, User_count, User_token } = db;
const { auditLog } = require("../utils/auditLog"); // ปรับ path ให้ตรง
const { notifyUser } = require("../utils/notifier"); // ที่ไฟล์ service/controller ของคุณ
const { getLocale, getCurrentUser } = require("../utils/currentUser");
const moment = require('moment-timezone');
const https = require("https");

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const TZ = 'Asia/Bangkok';

exports.listUsers = async ({ page, pageSize, where = {} }) => {
  // ป้องกันค่าผิดปกติ
  const limit = Math.max(parseInt(pageSize, 10) || 5, 1);
  const p = Math.max(Number(page) || 1, 1);
  const offset = (p - 1) * limit;

  const { role, status, search } = where || {};

  // 1) หา superadmin ids
  const superAdminIds = (
    await User_role.findAll({
      where: { role_id: 4 },
      attributes: ["user_id"],
      raw: true,
    })
  )
    .map((r) => r.user_id)
    .filter(Boolean);

  // 2) where ของ User
  const userWhere = {};

  if (status !== undefined && status !== null && String(status).trim() !== "") {
    const s = String(status).trim().toLowerCase();
    if (status === true || ["online", "true", "1", "ใช้งานอยู่"].includes(s)) userWhere.is_online = true;
    if (status === false || ["offline", "false", "0", "ไม่ใช้งาน"].includes(s)) userWhere.is_online = false;
  }

  const full = (search || "").replace(/\s+/g, " ").trim();
  if (full) {
    userWhere[Op.or] = [
      // ชื่อ + นามสกุล
      whereFn(
        fn("concat_ws", " ", col("firstname"), col("lastname")),
        {
          [Op.iLike]: `%${full}%`,
        }
      ),

      // group_name
      {
        group_name: {
          [Op.iLike]: `%${full}%`,
        },
      },
    ];
  }

  if (superAdminIds.length > 0) userWhere.id = { [Op.notIn]: superAdminIds };

  // include สำหรับ “กรอง role” (ต้อง join จริงใน query แรก)
  const includeRoleFilter = role
  ? [
      {
        model: User_role,
        as: "user_role",
        required: true,
        attributes: [], // ไม่ต้องเอาคอลัมน์
        include: [
          {
            model: Role,
            as: "role",
            required: true,
            attributes: [],
            where: {
              [Op.or]: [
                { role_name_th: role },
                { role_name_en: role },
              ],
            },
          },
        ],
      },
    ]
  : [];

  // ✅ Query แรก: เอา id + count
  const { rows: idRows, count } = await User.findAndCountAll({
    where: userWhere,
    attributes: ["id"],
    include: includeRoleFilter,
    order: [
      ["updatedAt", "DESC"],
      ["id", "ASC"], // ✅ กันลำดับสลับเมื่อ updatedAt เท่ากัน
    ],
    limit,
    offset,
    distinct: true,
    subQuery: false, // ✅ ช่วยหลีกเลี่ยง alias หลุดชั้น
  });

  const ids = idRows.map((r) => r.id);
  if (ids.length === 0) {
    return { items: [], page: p, pageSize: limit, totalCount: count };
  }

  // ✅ Query ที่สอง: ดึงข้อมูลเต็มด้วย include
  const includeUserRole = {
    model: User_role,
    as: "user_role",
    required: false,
    include: [
      { model: Role, as: "role", attributes: ["role_name_th", "role_name_en"], required: false },
    ],
  };

  const includeUserAi = {
    model: User_ai,
    as: "user_ai",
    required: false,
    include: [
      { model: Ai, as: "ai", attributes: ["model_name", "model_use_name", "model_type", "message_type"], required: false },
    ],
  };

  const items = await User.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: { exclude: ["password"] },
    include: [includeUserRole, includeUserAi],
    order: [
      ["updatedAt", "DESC"],
      ["id", "ASC"], // ✅ กันลำดับสลับเมื่อ updatedAt เท่ากัน
    ],
  });

  return { items, page: p, pageSize: limit, totalCount: count };
};

exports.getByUserId = async (id) => {
  // ---- คำนวณช่วงเวลา (โซนไทย) ----
  const nowTH = moment.tz(TZ);

  const usedDateToday = nowTH.format("YYYY-MM-DD");

  const startOfMonthTH = nowTH.clone().startOf("month");
  const startOfMonthStr = startOfMonthTH.format("YYYY-MM-DD");
  const startOfNextMonthStr = startOfMonthTH.clone().add(1, "month").format("YYYY-MM-DD");

  const daysElapsed = nowTH.diff(startOfMonthTH, "days") + 1;

  // ---- ดึงข้อมูลผู้ใช้ + สิทธิ์ AI (เหมือนเดิม) ----
  const user = await User.findByPk(id, {
    attributes: { exclude: ["password"] },
    include: [
      {
        model: User_role,
        as: "user_role",
        include: [
          {
            model: Role,
            as: "role",
            attributes: ["role_name_th", "role_name_en"],
            required: false,
          },
        ],
      },
      {
        model: User_ai,
        as: "user_ai",
        include: [
          {
            model: Ai,
            as: "ai",
            attributes: ["model_name", "model_use_name", "model_type", "message_type"],
            required: false,
          },
        ],
      },
    ],
  });

  if (!user) return null;
  const userData = user.toJSON();

  // ai_ids ที่ผู้ใช้นี้มีสิทธิ์ (ใช้จำกัดการคิวรีรวม เพื่อประหยัด)
  const aiIds = (userData.user_ai || [])
    .map((ua) => ua.ai_id)
    .filter((v) => v != null);

  // ---- รวมโทเคน "วันนี้" ต่อ ai_id ของผู้ใช้นี้ (จาก User_token) ----
  const todayAgg = await User_token.findAll({
    attributes: [
      "ai_id",
      [fn("COALESCE", fn("SUM", col("total_token")), 0), "tokens_today"],
    ],
    where: {
      user_id: id,
      ...(aiIds.length ? { ai_id: { [Op.in]: aiIds } } : {}),
      used_date: usedDateToday,
    },
    group: ["ai_id"],
    raw: true,
  });

  // ---- รวมโทเคน "เดือนนี้" ต่อ ai_id ของผู้ใช้นี้ (จาก User_token) ----
  const monthAgg = await User_token.findAll({
    attributes: [
      "ai_id",
      [fn("COALESCE", fn("SUM", col("total_token")), 0), "tokens_month"],
    ],
    where: {
      user_id: id,
      ...(aiIds.length ? { ai_id: { [Op.in]: aiIds } } : {}),
      used_date: { [Op.gte]: startOfMonthStr, [Op.lt]: startOfNextMonthStr },
    },
    group: ["ai_id"],
    raw: true,
  });

  // ---- ทำเป็นแผนที่ดูง่าย ----
  const todayMap = new Map(todayAgg.map((r) => [String(r.ai_id), Number(r.tokens_today) || 0]));
  const monthMap = new Map(monthAgg.map((r) => [String(r.ai_id), Number(r.tokens_month) || 0]));

  // ---- ใส่ today และ average ลงในแต่ละ user_ai ----
  const userAiWithStats = (userData.user_ai || []).map((ua) => {
    const key = String(ua.ai_id);
    const tokensToday = todayMap.get(key) ?? 0;
    const tokensMonth = monthMap.get(key) ?? 0;
    const average = daysElapsed > 0 ? Math.round(tokensMonth / daysElapsed) : 0;

    return {
      ...ua,
      today: tokensToday,
      average,
    };
  });

  return {
    ...userData,
    user_ai: userAiWithStats,
  };
};

exports.updateUser = async (id, input, ctx) => {
  return await User.sequelize.transaction(async (t) => {

    const locale = await getLocale(ctx);

    const user = await User.findByPk(id, {
      transaction: t,
      include: [
        {
          model: User_ai,
          as: "user_ai",
          include: [
            {
              model: Ai,
              as: "ai",
              attributes: ["model_name", "model_use_name", "model_type", "message_type"],
              required: false,
            },
          ],
        },
        {
          model: User_role,
          as: "user_role",
          include: [
            {
              model: Role,
              as: "role",
              attributes: ["role_name_th", "role_name_en"],
              required: false,
            },
          ],
        },
      ],
    });

    if (!user) throw new Error(locale === "th" ? "ไม่พบผู้ใช้" : "User not found");

    const { user_role, user_ai, ...userFields } = input;

    // console.log(user.user_ai);
    // console.log("user_ai", user_ai);

    const changedTokenAiIds = new Set();
    let isRoleChanged = false;
    let isStatusChanged = false;
    let isTokenChanged = false;

    // ---------------- ตรวจยอด token ไม่ให้เกิน ----------------
    if (Array.isArray(user_ai)) {
      for (const oldData of user.user_ai) {
        const newData = user_ai.find(
          (ai) => Number(ai.ai_id) === Number(oldData.ai_id)
        );

        // ถ้ามีการเพิ่ม token
        if (newData && newData.token_count > oldData.token_count) {
          // จำนวน token ทั้งหมดที่เหลืออยู่
          const aiData = await Ai.findByPk(Number(oldData.ai_id));

          // จำนวน token ทั้งหมดที่ได้เเจกจ่ายไปแล้ว
          const allUseToken = await User_ai.sum("token_count", {
            where: {
              ai_id: Number(oldData.ai_id),
              token_count: { [Op.ne]: 0 },
            },
          });
          //console.log("allUseToken", allUseToken);
          
          if (allUseToken + (newData.token_count - oldData.token_count) >= aiData.token_count) {
            throw new Error(
              locale === "th"
                ? "จำนวน token ที่เหลืออยู่ไม่เพียงพอ"
                : "Insufficient remaining tokens"
            );
          }
        }
      }
    }

    // ---------------- log & notify การเปลี่ยน role ----------------
    if (Array.isArray(user_role)) {    
      const old_role_id = user_role[0].role_id
      const new_role_id = user.user_role[0].role_id

      const old_role_name_th = user.user_role[0].role.role_name_th
      const new_role_name_th = user_role[0].role_name_th

      const old_role_name_en = user.user_role[0].role.role_name_en
      const new_role_name_en = user_role[0].role_name_en

      if (Number(old_role_id) !== Number(new_role_id)) {
        isRoleChanged = true;

        const th_old_message = `กำหนดบทบาทของผู้ใช้งาน (${user.firstname} ${user.lastname}) ${old_role_name_th}`;
        const th_new_message = `กำหนดบทบาทของผู้ใช้งาน (${user.firstname} ${user.lastname}) ${new_role_name_th}`;

        const en_old_message = `Set user role (${user.firstname} ${user.lastname}) ${old_role_name_en}`;
        const en_new_message = `Set user role (${user.firstname} ${user.lastname}) ${new_role_name_en}`;

        // ภาษาไทย
        await auditLog({
          ctx,
          locale: "th",
          log_type: "ROLE",
          old_data: th_old_message,
          new_data: th_new_message,
          old_status: null,
          new_status: null,
        });

        // ภาษาอังกฤษ
        await auditLog({
          ctx,
          locale: "en",
          log_type: "ROLE",
          old_data: en_old_message,
          new_data: en_new_message,
          old_status: null,
          new_status: null,
        });

        // ภาษาไทย
        await notifyUser({
          locale: "th",
          recipient_locale: user.locale,
          loginAt: user.loginAt,
          userId: id,
          title: "เเจ้งเตือนตั้งค่าบทบาทของผู้ใช้งาน",
          message: `กำหนดบทบาทของผู้ใช้งาน จาก ${old_role_name_th} เป็น ${new_role_name_th} กรุณา Refresh เว็ปไซต์ 1 ครั้ง`,
          type: "INFO",
          to: user.email,
        });

        // ภาษาอังกฤษ
        await notifyUser({
          locale: "en",
          recipient_locale: user.locale,
          loginAt: user.loginAt,
          userId: id,
          title: "User Role Settings Notification",
          message: `Your user role has been changed from ${old_role_name_en} to ${new_role_name_en}. Please refresh the website once.`,
          type: "INFO",
          to: user.email,
        });
      }
    }

    // ---------------- log & notify การเปลี่ยน ai_access ----------------
    if (user.ai_access !== input.ai_access && input.ai_access !== undefined) {
      isStatusChanged = true;

      const th_message = `กำหนด AI Access ของผู้ใช้งาน (${user.firstname} ${user.lastname})`;
      const en_message = `Set AI Access for user (${user.firstname} ${user.lastname})`;

      // ภาษาไทย
      await auditLog({
        ctx,
        locale: "th",
        log_type: "PERSONAL",
        old_data: th_message,
        new_data: th_message,
        old_status: user.ai_access,
        new_status: input?.ai_access,
      });

      // ภาษาอังกฤษ
      await auditLog({
        ctx,
        locale: "en",
        log_type: "PERSONAL",
        old_data: en_message,
        new_data: en_message,
        old_status: user.ai_access,
        new_status: input?.ai_access,
      });

      const toApproval = (val) => {
        if (typeof val === "string")
          return ["true", "1", "yes", "y"].includes(val.toLowerCase());
        if (typeof val === "number") return val === 1;
        return !!val;
      };
      const th_label = (val) => (toApproval(val) ? "อนุมัติ" : "ไม่อนุมัติ");
      const en_label = (val) => (toApproval(val) ? "Active" : "Inactive");

      // ภาษาไทย
      await notifyUser({
        locale: "th",
        recipient_locale: user.locale,
        loginAt: user.loginAt,
        userId: id,
        title: "เเจ้งเตือนตั้งค่า Model ของผู้ใช้งาน",
        message: `กำหนด AI Access ของผู้ใช้งาน จาก ${th_label(user.ai_access)} เป็น ${th_label(input?.ai_access)}`,
        type: "INFO",
        to: user.email,
      });

      // ภาษาอังกฤษ
      await notifyUser({
        locale: "en",
        recipient_locale: user.locale,
        loginAt: user.loginAt,
        userId: id,
        title: "User Model Settings Notification",
        message: `Your AI access has been changed from ${en_label(user.ai_access)} to ${en_label(input?.ai_access)}.`,
        type: "INFO",
        to: user.email,
      });
    }

    // ---------------- log & notify การเปลี่ยน token ----------------
    if (Array.isArray(user_ai)) {
      for (const oldData of user.user_ai) {
        const newData = user_ai.find(
          (ai) => Number(ai.ai_id) === Number(oldData.ai_id)
        );

        if (newData && oldData.token_count !== newData.token_count) {
          isTokenChanged = true;

          const th_old_message = `จำนวน Token ของ Model (${oldData.ai.model_use_name}) ของผู้ใช้งาน (${user.firstname} ${user.lastname}) ${oldData.token_count.toLocaleString()}`;
          const th_new_message = `จำนวน Token ของ Model (${oldData.ai.model_use_name}) ของผู้ใช้งาน (${user.firstname} ${user.lastname}) ${newData.token_count.toLocaleString()}`;

          const en_old_message = `Token count for model (${oldData.ai.model_use_name}) for user (${user.firstname} ${user.lastname}) ${oldData.token_count.toLocaleString()}`;
          const en_new_message = `Token count for model (${oldData.ai.model_use_name}) for user (${user.firstname} ${user.lastname}) ${newData.token_count.toLocaleString()}`;

          // ภาษาไทย
          await auditLog({
            ctx,
            locale: "th",
            log_type: "PERSONAL",
            old_data: th_old_message,
            new_data: th_new_message,
            old_status: null,
            new_status: null,
          });

          // ภาษาอังกฤษ
          await auditLog({
            ctx,
            locale: "en",
            log_type: "PERSONAL",
            old_data: en_old_message,
            new_data: en_new_message,
            old_status: null,
            new_status: null,
          });

          await notifyUser({
            locale: "th",
            recipient_locale: user.locale,
            loginAt: user.loginAt,
            userId: id,
            title: "เเจ้งเตือนตั้งค่า Model ของผู้ใช้งาน",
            message: `จำนวน Token ของ Model (${oldData.ai.model_use_name}) จาก ${oldData.token_count.toLocaleString()} เป็น ${newData.token_count.toLocaleString()}`,
            type: "INFO",
            to: user.email,
          });

          await notifyUser({
            locale: "en",
            recipient_locale: user.locale,
            loginAt: user.loginAt,
            userId: id,
            title: "User Model Settings Notification",
            message: `Token count for model (${oldData.ai.model_use_name}) has been changed from ${oldData.token_count.toLocaleString()} to ${newData.token_count.toLocaleString()}.`,
            type: "INFO",
            to: user.email,
          });

          changedTokenAiIds.add(Number(oldData.ai_id));
        }
      }
    }

    // ต้องมีการเปลี่ยน status หรือ token ถึงจะเขียน DB
    const allowWrite = isRoleChanged || isStatusChanged || isTokenChanged;

    // ---------------- update ฟิลด์ user ปกติ ----------------
    if (allowWrite && Object.keys(userFields).length) {
      await user.update(userFields, { transaction: t });
    }

    // ---------------- user_role (ถ้าจะให้ละเอียดแบบ object ต่อ object เหมือน user_ai
    // ตรงนี้สามารถ refactor ต่อทีหลังได้ ตอนนี้ยัง destroy+bulkCreate เหมือนเดิม) -----------
    if (allowWrite && Array.isArray(user_role)) {
      await User_role.destroy({ where: { user_id: id }, transaction: t });
      const unique = [...new Set(user_role.map((r) => r.role_id))];
      if (unique.length) {
        await User_role.bulkCreate(
          unique.map((role_id) => ({ user_id: id, role_id })),
          { transaction: t }
        );
      }
    }

    // ---------------- user_ai: เขียนเฉพาะ object ที่มีการเปลี่ยน ----------------
    if (allowWrite && Array.isArray(user_ai)) {
      // map ของของเดิม
      const existingByAi = new Map(
        user.user_ai.map((ua) => [Number(ua.ai_id), ua])
      );

      // map ของ input (กันซ้ำ ai_id)
      const inputByAi = new Map();
      for (const it of user_ai) {
        const key = Number(it.ai_id);
        if (!inputByAi.has(key)) inputByAi.set(key, it);
      }

      // upsert / update เฉพาะตัวที่มีการเปลี่ยน
      for (const [aiId, it] of inputByAi.entries()) {
        const oldData = existingByAi.get(aiId);

        let is_notification;
        if (changedTokenAiIds.has(aiId)) {
          // token เปลี่ยน → reset false
          is_notification = false;
        } else if (oldData) {
          // token ไม่เปลี่ยน → ใช้ค่าเดิม
          is_notification = oldData.is_notification;
        }

        const newTokenCount = it.token_count ?? null;
        const newTokenAll = it.token_all ?? null;

        if (!oldData) {
          // ✅ case ใหม่ ยังไม่มีใน DB → create
          await User_ai.create(
            {
              user_id: id,
              ai_id: aiId,
              token_count: newTokenCount,
              token_all: newTokenAll,
              ...(typeof is_notification !== "undefined" && { is_notification }),
            },
            { transaction: t }
          );
        } else {
          // ✅ case มีใน DB แล้ว → เช็คว่าข้อมูลเปลี่ยนจริงไหมก่อน update
          const hasChanged =
            oldData.token_count !== newTokenCount ||
            (typeof is_notification !== "undefined" &&
              oldData.is_notification !== is_notification);

          if (hasChanged) {
            await oldData.update(
              {
                token_count: newTokenCount,
                token_all: newTokenAll,
                ...(typeof is_notification !== "undefined" && {
                  is_notification,
                }),
              },
              { transaction: t }
            );
          }
        }
      }

      // ลบตัวที่มีใน DB แต่ไม่มีใน input (ถือว่าโดนลบออก)
      for (const [aiId, oldData] of existingByAi.entries()) {
        if (!inputByAi.has(aiId)) {
          await oldData.destroy({ transaction: t });
        }
      }
    }

    // ---------------- โหลดกลับพร้อม relation ----------------
    return await User.findByPk(id, {
      include: [
        {
          model: User_role,
          as: "user_role",
          include: [{ model: Role, as: "role", attributes: ["role_name_th", "role_name_en"] }],
        },
        {
          model: User_ai,
          as: "user_ai",
          include: [
            {
              model: Ai,
              as: "ai",
              attributes: ["model_name", "model_use_name", "model_type", "message_type"],
            },
          ],
        },
      ],
      transaction: t,
    });
  });
};

exports.updateUsers = async (input, ctx) => {
  const auditQueue = [];
  const notifyQueue = [];

  const result = await User.sequelize.transaction(async (t) => {
    const locale = await getLocale(ctx);

    if (!Array.isArray(input) || input.length === 0) {
      return [];
    }

    const normalizeText = (v) =>
      String(v ?? "")
        .trim()
        .replace(/\s+/g, " ");

    const makeUserKey = (name, groupName) =>
      `${normalizeText(name).toLowerCase()}||${normalizeText(groupName).toLowerCase()}`;

    const makeModelKey = (model) => normalizeText(model).toLowerCase();

    const toApproval = (val) => {
      if (typeof val === "string") {
        return ["true", "1", "yes", "y"].includes(val.toLowerCase());
      }
      if (typeof val === "number") return val === 1;
      return !!val;
    };

    const thLabel = (val) => (toApproval(val) ? "อนุมัติ" : "ไม่อนุมัติ");
    const enLabel = (val) => (toApproval(val) ? "Active" : "Inactive");

    // ---------------- รวม input ซ้ำของ user เดียวกัน ----------------
    const mergedRowsMap = new Map();

    for (const row of input) {
      const name = normalizeText(row?.name);
      const groupName = normalizeText(row?.group_name);
      const models = Array.isArray(row?.models) ? row.models : [];

      if (!name || !groupName) continue;

      const userKey = makeUserKey(name, groupName);

      if (!mergedRowsMap.has(userKey)) {
        mergedRowsMap.set(userKey, {
          name,
          group_name: groupName,
          ai_access: row?.ai_access,
          modelsMap: new Map(),
        });
      }

      const rowRef = mergedRowsMap.get(userKey);

      if (row?.ai_access !== undefined) {
        rowRef.ai_access = row.ai_access;
      }

      for (const m of models) {
        const modelName = normalizeText(m?.model);
        if (!modelName) continue;

        const tokenCount =
          m?.token_count === null || m?.token_count === undefined
            ? null
            : Number(m.token_count);

        if (tokenCount !== null && !Number.isInteger(tokenCount)) {
          throw new Error(
            locale === "th"
              ? `token_count ของ model (${modelName}) ไม่ถูกต้อง`
              : `Invalid token_count for model (${modelName})`
          );
        }

        rowRef.modelsMap.set(makeModelKey(modelName), {
          model: modelName,
          token_count: tokenCount,
        });
      }
    }

    const mergedRows = [...mergedRowsMap.values()].map((r) => ({
      name: r.name,
      group_name: r.group_name,
      ai_access: r.ai_access,
      models: [...r.modelsMap.values()],
    }));

    if (!mergedRows.length) {
      return [];
    }

    // ---------------- โหลด user ตาม group_name ก่อน แล้ว match name ใน JS ----------------
    const groupNames = [...new Set(mergedRows.map((r) => r.group_name))];

    const users = await User.findAll({
      where: {
        group_name: { [Op.in]: groupNames },
      },
      include: [
        {
          model: User_ai,
          as: "user_ai",
          required: false,
          include: [
            {
              model: Ai,
              as: "ai",
              attributes: [
                "id",
                "model_name",
                "model_use_name",
                "model_type",
                "message_type",
                "token_count",
              ],
              required: false,
            },
          ],
        },
      ],
      transaction: t,
    });

    const userMap = new Map();

    for (const user of users) {
      const fullName = normalizeText(`${user.firstname ?? ""} ${user.lastname ?? ""}`);
      const key = makeUserKey(fullName, user.group_name);

      if (userMap.has(key)) {
        throw new Error(
          locale === "th"
            ? `พบผู้ใช้ซ้ำในระบบ: ${fullName} / ${user.group_name}`
            : `Duplicate user found in system: ${fullName} / ${user.group_name}`
        );
      }

      userMap.set(key, user);
    }

    // ---------------- โหลด ai ทั้งหมด แล้ว map จาก model header -> ai ----------------
    const aiRows = await Ai.findAll({
      attributes: ["id", "model_name", "model_use_name", "token_count"],
      transaction: t,
    });

    const aiMap = new Map();
    const aiById = new Map();

    for (const ai of aiRows) {
      aiById.set(Number(ai.id), ai);

      const key1 = makeModelKey(ai.model_use_name);
      if (key1) aiMap.set(key1, ai);

      const key2 = makeModelKey(ai.model_name);
      if (key2 && !aiMap.has(key2)) aiMap.set(key2, ai);
    }

    // ---------------- resolve input -> user + user_ai ที่จะเปลี่ยน ----------------
    const resolvedRows = [];
    const deltaByAiId = new Map();

    for (const row of mergedRows) {
      const userKey = makeUserKey(row.name, row.group_name);
      const user = userMap.get(userKey);

      if (!user) {
        throw new Error(
          locale === "th"
            ? `ไม่พบผู้ใช้: ${row.name} / ${row.group_name}`
            : `User not found: ${row.name} / ${row.group_name}`
        );
      }

      const existingUserAiMap = new Map(
        (user.user_ai || []).map((ua) => [Number(ua.ai_id), ua])
      );

      const changes = [];

      for (const modelInput of row.models) {
        const ai = aiMap.get(makeModelKey(modelInput.model));

        if (!ai) {
          throw new Error(
            locale === "th"
              ? `ไม่พบ model (${modelInput.model}) ในระบบ`
              : `Model not found in system (${modelInput.model})`
          );
        }

        const oldUserAi = existingUserAiMap.get(Number(ai.id));

        if (!oldUserAi) {
          throw new Error(
            locale === "th"
              ? `ผู้ใช้ ${row.name} / ${row.group_name} ไม่มี model (${modelInput.model}) ใน user_ai`
              : `User ${row.name} / ${row.group_name} does not have model (${modelInput.model}) in user_ai`
          );
        }

        const oldToken = oldUserAi.token_count ?? null;
        const newToken = modelInput.token_count ?? null;

        if (oldToken !== newToken) {
          changes.push({
            ai,
            oldUserAi,
            oldToken,
            newToken,
          });

          const delta = (newToken ?? 0) - (oldToken ?? 0);
          const aiId = Number(ai.id);

          deltaByAiId.set(aiId, (deltaByAiId.get(aiId) || 0) + delta);
        }
      }

      const hasAiAccessInput = row.ai_access !== undefined;
      const oldAiAccess = user.ai_access;
      const newAiAccess = row.ai_access;
      const isAiAccessChanged =
        hasAiAccessInput && oldAiAccess !== newAiAccess;

      resolvedRows.push({
        user,
        changes,
        hasAiAccessInput,
        isAiAccessChanged,
        oldAiAccess,
        newAiAccess,
      });
    }

    // ---------------- ตรวจยอด token รวมของทุก user ที่เปลี่ยน ----------------
    for (const [aiId, totalDelta] of deltaByAiId.entries()) {
      const aiData = aiById.get(aiId);

      if (!aiData) {
        throw new Error(
          locale === "th"
            ? `ไม่พบข้อมูล AI id=${aiId}`
            : `AI not found id=${aiId}`
        );
      }

      const allUseToken =
        (await User_ai.sum("token_count", {
          where: {
            ai_id: aiId,
            token_count: { [Op.ne]: 0 },
          },
          transaction: t,
        })) || 0;

      const projectedTotal = Number(allUseToken) + Number(totalDelta);

      if (projectedTotal >= Number(aiData.token_count)) {
        throw new Error(
          locale === "th"
            ? "จำนวน token ที่เหลืออยู่ไม่เพียงพอ"
            : "Insufficient remaining tokens"
        );
      }
    }

    // ---------------- update DB ก่อน แล้วค่อย queue log/notify ----------------
    for (const row of resolvedRows) {
      const {
        user,
        changes,
        hasAiAccessInput,
        isAiAccessChanged,
        oldAiAccess,
        newAiAccess,
      } = row;

      // -------- ai_access --------
      if (hasAiAccessInput && isAiAccessChanged) {
        const th_message = `กำหนด AI Access ของผู้ใช้งาน (${user.firstname} ${user.lastname})`;
        const en_message = `Set AI Access for user (${user.firstname} ${user.lastname})`;

        // สำคัญ: ใช้ oldAiAccess ที่ capture ไว้ก่อน update
        await user.update(
          { ai_access: newAiAccess },
          { transaction: t }
        );

        auditQueue.push({
          ctx,
          locale: "th",
          log_type: "PERSONAL",
          old_data: th_message,
          new_data: th_message,
          old_status: oldAiAccess,
          new_status: newAiAccess,
        });

        auditQueue.push({
          ctx,
          locale: "en",
          log_type: "PERSONAL",
          old_data: en_message,
          new_data: en_message,
          old_status: oldAiAccess,
          new_status: newAiAccess,
        });

        notifyQueue.push({
          locale: "th",
          recipient_locale: user.locale,
          loginAt: user.loginAt,
          userId: user.id,
          title: "เเจ้งเตือนตั้งค่า Model ของผู้ใช้งาน",
          message: `กำหนด AI Access ของผู้ใช้งาน จาก ${thLabel(oldAiAccess)} เป็น ${thLabel(newAiAccess)}`,
          type: "INFO",
          to: user.email,
        });

        notifyQueue.push({
          locale: "en",
          recipient_locale: user.locale,
          loginAt: user.loginAt,
          userId: user.id,
          title: "User Model Settings Notification",
          message: `Your AI access has been changed from ${enLabel(oldAiAccess)} to ${enLabel(newAiAccess)}.`,
          type: "INFO",
          to: user.email,
        });
      }

      // -------- token --------
      for (const ch of changes) {
        const modelUseName =
          ch.oldUserAi?.ai?.model_use_name ||
          ch.ai?.model_use_name ||
          ch.ai?.model_name;

        const oldTokenText = Number(ch.oldToken ?? 0).toLocaleString();
        const newTokenText = Number(ch.newToken ?? 0).toLocaleString();

        const th_old_message = `จำนวน Token ของ Model (${modelUseName}) ของผู้ใช้งาน (${user.firstname} ${user.lastname}) ${oldTokenText}`;
        const th_new_message = `จำนวน Token ของ Model (${modelUseName}) ของผู้ใช้งาน (${user.firstname} ${user.lastname}) ${newTokenText}`;

        const en_old_message = `Token count for model (${modelUseName}) for user (${user.firstname} ${user.lastname}) ${oldTokenText}`;
        const en_new_message = `Token count for model (${modelUseName}) for user (${user.firstname} ${user.lastname}) ${newTokenText}`;

        await ch.oldUserAi.update(
          {
            token_count: ch.newToken,
            token_all: ch.newToken,
            is_notification: false,
          },
          { transaction: t }
        );

        auditQueue.push({
          ctx,
          locale: "th",
          log_type: "PERSONAL",
          old_data: th_old_message,
          new_data: th_new_message,
          old_status: null,
          new_status: null,
        });

        auditQueue.push({
          ctx,
          locale: "en",
          log_type: "PERSONAL",
          old_data: en_old_message,
          new_data: en_new_message,
          old_status: null,
          new_status: null,
        });

        notifyQueue.push({
          locale: "th",
          recipient_locale: user.locale,
          loginAt: user.loginAt,
          userId: user.id,
          title: "เเจ้งเตือนตั้งค่า Model ของผู้ใช้งาน",
          message: `จำนวน Token ของ Model (${modelUseName}) จาก ${oldTokenText} เป็น ${newTokenText}`,
          type: "INFO",
          to: user.email,
        });

        notifyQueue.push({
          locale: "en",
          recipient_locale: user.locale,
          loginAt: user.loginAt,
          userId: user.id,
          title: "User Model Settings Notification",
          message: `Token count for model (${modelUseName}) has been changed from ${oldTokenText} to ${newTokenText}.`,
          type: "INFO",
          to: user.email,
        });
      }
    }

    // ---------------- โหลดกลับตามลำดับ input ----------------
    const returnIds = [
      ...new Set(resolvedRows.map((r) => Number(r.user.id)).filter(Boolean)),
    ];

    if (!returnIds.length) {
      return [];
    }

    const updatedUsers = await User.findAll({
      where: {
        id: { [Op.in]: returnIds },
      },
      include: [
        {
          model: User_ai,
          as: "user_ai",
          required: false,
          include: [
            {
              model: Ai,
              as: "ai",
              attributes: ["model_use_name", "model_name"],
              required: false,
            },
          ],
        },
      ],
      transaction: t,
    });

    const updatedUserMap = new Map(
      updatedUsers.map((u) => [Number(u.id), u])
    );

    return returnIds.map((id) => updatedUserMap.get(id)).filter(Boolean);
  });

  // ---------------- ทำ log / notify หลัง transaction commit ----------------
  for (const log of auditQueue) {
    await auditLog(log);
  }

  for (const noti of notifyQueue) {
    await notifyUser(noti);
  }

  return result;
};

exports.updateThemeAndLocale = async (id, input) => {
  const row = await User.findByPk(id);
  if (!row) throw new Error(locale === "th" ? "ไม่พบผู้ใช้" : "User not found");

  await row.update(input);
  return row;
}

exports.deleteUser = async (id) => {
  const count = await User.destroy({ where: { id } });
  return count > 0;
};

// ✅ helper: ใช้เรียก ONESQA และถ้า ONESQA "ล่มจริง" ให้ throw ตามที่ต้องการ
const ONESQA_TIMEOUT = 10000;

const isOnesqaDownError = (err) => {
  const status = err?.response?.status;

  // ไม่มี response = network/timeout/DNS/ECONNREFUSED ฯลฯ
  if (!err?.response) return true;

  // 5xx = ฝั่ง ONESQA มีปัญหา
  if (typeof status === "number" && status >= 500) return true;

  return false;
};

async function onesqaPost(endpoint, data, headers, locale) {
  try {
    return await axios.post(`${process.env.ONESQA_URL}${endpoint}`, data, {
      httpsAgent,
      headers,
      timeout: ONESQA_TIMEOUT,
    });
  } catch (err) {
    if (isOnesqaDownError(err)) {
      throw new Error(
        locale === "th"
          ? "ระบบ ONESQA ไม่พร้อมใช้งาน"
          : "ONESQA system is unavailable"
      );
    }
    // ✅ 4xx หรือ error อื่น ๆ ให้คง behavior เดิม (throw ต่อไป)
    throw err;
  }
}

async function upsertUserCountDaily(totalUser) {
  const today = moment.tz(TZ).startOf("day");
  const todayStr = today.format("YYYY-MM-DD");

  // หาแถวล่าสุด (อิง count_date)
  const lastRow = await User_count.findOne({
    order: [["count_date", "DESC"]],
    raw: true,
  });

  const lastDate = lastRow?.count_date
    ? moment.tz(String(lastRow.count_date), TZ).startOf("day")
    : null;

  // ค่าไว้เติมวันที่ขาด (6-9) ใช้ค่าล่าสุดที่มีอยู่ ไม่งั้น 0
  const carry = lastRow ? Number(lastRow.total_user) || 0 : 0;

  // 1) Backfill วันขาด: จากวันถัดจาก lastDate -> เมื่อวาน
  if (lastDate && lastDate.isBefore(today, "day")) {
    const rows = [];
    for (
      let d = lastDate.clone().add(1, "day");
      d.isBefore(today, "day");
      d.add(1, "day")
    ) {
      rows.push({
        count_date: d.format("YYYY-MM-DD"),
        total_user: carry,
      });
    }

    if (rows.length) {
      await User_count.bulkCreate(rows, { ignoreDuplicates: true });
      // console.log(
      //   `📊 Backfilled user_count: ${rows[0].count_date} -> ${rows[rows.length - 1].count_date} (total_user=${carry})`
      // );
    }
  }

  // 2) Upsert ของวันนี้ด้วยค่าที่คำนวณจาก API จริง
  // ถ้ามีแล้วให้ update, ไม่มีให้ create
  const [row, created] = await User_count.findOrCreate({
    where: { count_date: todayStr },
    defaults: { total_user: totalUser },
  });

  if (!created) {
    await User_count.update(
      { total_user: totalUser },
      { where: { count_date: todayStr } }
    );
    // console.log(`📊 Updated user_count today (${todayStr}) total_user=${totalUser}`);
  } else {
    // console.log(`📊 Created user_count today (${todayStr}) total_user=${totalUser}`);
  }

  return { count_date: todayStr, total_user: totalUser };
}
exports.syncUsersFromApi = async (ctx) => {
  const locale = await getLocale(ctx);

  let staffApiCount = 0;
  let assessorApiCount = 0;

  const SPECIAL_ID = "Admin01";

  const officerRoleName = "เจ้าหน้าที่";
  const adminRoleName = "ผู้ดูแลระบบ";

  const assessorGroupName = "กลุ่มผู้ประเมินภายนอก";
  const assessorRoleName = "ผู้ประเมินภายนอก";

  const headers = {
    Accept: "application/json",
    "X-Auth-ID": process.env.X_AUTH_ID,
    "X-Auth-Token": process.env.X_AUTH_TOKEN,
  };

  const existingGroups = await Group.findAll({
    attributes: ["id", "group_api_id", "name", "status"],
    where: { group_api_id: { [Op.ne]: null } },
    raw: true,
  });
  // ✅ หา group เพื่อดึง group_ai (init_token)
  const assessorGroup = await Group.findOne({
    where: { name: assessorGroupName },
    attributes: ["id", "name", "status"],
    raw: true,
  });
  const assessorGroupAis = await Group_ai.findAll({
    where: { group_id: assessorGroup.id },
    attributes: ["ai_id", "init_token"],
    raw: true,
  });

  // -------------------------------
  // 1) ดึง assessor ทั้งหมดแบบ pagination
  // -------------------------------
  const length = 1000;

  // ✅ REPLACE: axios.post -> onesqaPost
  const first = await onesqaPost(
    "/assessments/get_assessor",
    { start: "0", length: String(length) },
    headers,
    locale
  );

  const total = Number(first.data?.total ?? 0);
  const firstItems = Array.isArray(first.data?.data) ? first.data.data : [];
  const pages = Math.ceil(total / length);

  const assessors = [...firstItems];

  for (let page = 1; page < pages; page++) {
    const start = page * length;

    // ✅ REPLACE: axios.post -> onesqaPost
    const res = await onesqaPost(
      "/assessments/get_assessor",
      { start: String(start), length: String(length) },
      headers,
      locale
    );
    const items = Array.isArray(res.data?.data) ? res.data.data : [];
    assessors.push(...items);
  }
  // console.log("✅ assessors fetched:", assessors.length);

  // 1) ✅ ดึง username ที่มีอยู่แล้วใน DB ไว้ตัดของเดิมออกจาก API
  const dbUsers = await User.findAll({
    attributes: ["username"],
    where: { username: { [Op.ne]: null } },
    raw: true,
  });

  const existingUsernameSet = new Set(
    dbUsers
      .map((u) => String(u.username || "").trim())
      .filter(Boolean)
  );

  // 2) ✅ DB USED: รวม token_count ของ User_ai แยกตาม ai_id (token_count != 0)
  const dbUsedRows = await User_ai.findAll({
    attributes: ["ai_id", [fn("SUM", col("token_count")), "used"]],
    where: { token_count: { [Op.ne]: 0 } },
    group: ["ai_id"],
    raw: true,
  });

  const dbUsedByAiId = new Map(
    dbUsedRows.map((r) => [Number(r.ai_id), Number(r.used) || 0])
  );

  // 3) ✅ API ADD: สะสม (newUserCount * init_token) แยกตาม ai_id
  const apiAddByAiId = new Map(); // ai_id -> token ที่จะเพิ่มจาก user ใหม่

  // helper: key ของ user จาก API get_user
  // helper: key ของ assessor จาก API get_assessor (ใช้ id_card)
  const getAssessorKey = (a) => String(a?.id_card ?? "").trim();

  // ----------------------------------------------------
  // 3.A) ✅ เพิ่ม get_assessor เข้าไปในการคำนวณ (เฉพาะ user ใหม่)
  //     โดยใช้ id_card เทียบกับ username ใน DB
  // ----------------------------------------------------
  if (!assessorGroup || !assessorGroup.id) {
    throw new Error(
      locale === "th"
        ? `ไม่พบ assessor group: ${assessorGroupName}`
        : `Assessor group not found: ${assessorGroupName}`
    );
  }

  if (assessorGroupAis?.length) {
    const newAssessors = assessors.filter((a) => {
      const key = getAssessorKey(a); // ✅ id_card
      if (!key) return false;
      return !existingUsernameSet.has(key); // ✅ DB username เก็บ id_card
    });

    const newAssessorCount = newAssessors.length;

    if (newAssessorCount > 0) {
      // กันนับซ้ำในรอบเดียวกัน
      for (const a of newAssessors) {
        const key = getAssessorKey(a);
        if (key) existingUsernameSet.add(key); // ✅ add id_card เข้า set
      }

      // คิด token เพิ่มของ assessor ตาม group_ai ของ assessorGroup
      for (const ga of assessorGroupAis) {
        const aiId = Number(ga.ai_id);
        const initToken = Number(ga.init_token) || 0;
        if (!aiId || initToken === 0) continue;

        const add = newAssessorCount * initToken;
        apiAddByAiId.set(aiId, (apiAddByAiId.get(aiId) || 0) + add);
      }
    }
  } 

  // ----------------------------------------------------
  // 3.B) ✅ ของเดิม: วนทุก group แล้วคิดเฉพาะ user ใหม่จาก get_user (ใช้ username ตามเดิม)
  // ----------------------------------------------------
  for (const g of existingGroups) {
    // 3.1) ดึง group_ai ของกลุ่มนี้
    const groupAis = await Group_ai.findAll({
      where: { group_id: g.id },
      attributes: ["ai_id", "init_token"],
      raw: true,
    });
    if (!groupAis?.length) continue;

    // ✅ REPLACE: axios.post -> onesqaPost
    const response = await onesqaPost(
      "/basics/get_user",
      { group_id: String(g.group_api_id) },
      headers,
      locale
    );

    const users = Array.isArray(response.data?.data) ? response.data.data : [];
    if (!users.length) continue;

    // 3.3) ตัด user ที่มีอยู่แล้วใน DB ออก (เทียบด้วย username)
    const newUsers = users.filter((u) => {
      const username = String(u?.username || "").trim();
      if (!username) return false;
      return !existingUsernameSet.has(username);
    });

    const newUserCount = newUsers.length;
    if (newUserCount === 0) continue;

    // กันการนับซ้ำ username ข้ามกลุ่มในรอบเดียวกัน
    for (const u of newUsers) {
      const username = String(u?.username || "").trim();
      if (username) existingUsernameSet.add(username);
    }

    // 3.4) คูณ newUserCount กับ init_token ของ group_ai แต่ละตัว แล้วรวมใส่ Map
    for (const ga of groupAis) {
      const aiId = Number(ga.ai_id);
      const initToken = Number(ga.init_token) || 0;
      if (!aiId || initToken === 0) continue;

      const add = newUserCount * initToken;
      apiAddByAiId.set(aiId, (apiAddByAiId.get(aiId) || 0) + add);
    }
  }

  // 4) ✅ เทียบกับ token_count ของ Ai โดยใช้ (DB + API ใหม่)
  const aiIds = Array.from(
    new Set([...dbUsedByAiId.keys(), ...apiAddByAiId.keys()])
  );

  //if (aiIds.length === 0) return; // ไม่มีอะไรต้องเช็ค

  const ais = await Ai.findAll({
    where: { id: { [Op.in]: aiIds } },
    attributes: ["id", "token_count"],
    raw: true,
  });

  const quotaByAiId = new Map(
    ais.map((a) => [Number(a.id), Number(a.token_count) || 0])
  );

  const exceeded = [];
  for (const aiId of aiIds) {
    const dbUsed = dbUsedByAiId.get(aiId) || 0;
    const apiAdd = apiAddByAiId.get(aiId) || 0;
    const total = dbUsed + apiAdd;

    const quota = quotaByAiId.get(aiId);

    // console.log("aiId", aiId);
    // console.log("dbUsed", dbUsed);
    // console.log("apiAdd(new)", apiAdd);
    // console.log("total", total);
    // console.log("quota", quota);

    // ไม่เจอ ai => error
    if (quota == null) {
      exceeded.push({ aiId, dbUsed, apiAdd, total, quota: null });
      continue;
    }

    // กันเคส total=0 แล้ว quota=0 จะชนเงื่อนไขโดยไม่จำเป็น
    if (total > 0 && total >= quota) {
      exceeded.push({ aiId, dbUsed, apiAdd, total, quota });
    }
  }
  if (exceeded.length > 0) {
    throw new Error(locale === "th" ? "โควตา token ของ AI ไม่พอ" : "AI token quota is insufficient");
  }

  // ส่วนของข้อมูล เจ้าหน้าที่
  try {
    // ✅ หา role_id ของ "เจ้าหน้าที่" และ "ผู้ดูแลระบบ" ก่อน (ทำครั้งเดียว)
    const [officerRole, adminRole] = await Promise.all([
      Role.findOne({
        where: { role_name_th: officerRoleName },
        attributes: ["id"],
        raw: true,
      }),
      Role.findOne({
        where: { role_name_th: adminRoleName },
        attributes: ["id"],
        raw: true,
      }),
    ]);

    if (!officerRole?.id) {
      throw new Error(
        locale === "th"
          ? `ไม่พบ Role: ${officerRoleName}`
          : `Role not found: ${officerRoleName}`
      );
    }
    if (!adminRole?.id) {
      throw new Error(
        locale === "th"
          ? `ไม่พบ Role: ${adminRoleName}`
          : `Role not found: ${adminRoleName}`
      );
    }
    const officerRoleId = officerRole.id;
    const adminRoleId = adminRole.id;

    let created = 0;
    let updated = 0;
    let deletedDup = 0;
    let deletedMissing = 0;
    let userAiCreated = 0;
    let userRoleCreated = 0;

    for (const g of existingGroups) {
      try {
        const groupAis = await Group_ai.findAll({
          where: { group_id: g.id },
          attributes: ["ai_id", "init_token"],
          raw: true,
        });

        // ✅ REPLACE: axios.post -> onesqaPost
        const response = await onesqaPost(
          "/basics/get_user",
          { group_id: String(g.group_api_id) },
          headers,
          locale
        );

        const users = Array.isArray(response.data?.data) ? response.data.data : [];

        staffApiCount += users.length

        const apiUsernames = users
          .map((u) => (u?.username || "").trim())
          .filter((x) => x && x !== SPECIAL_ID);

        const isAdminGroup = String(g?.name ?? "").trim().toLowerCase() === "admin";
        const roleIdForGroup = isAdminGroup ? adminRoleId : officerRoleId;

        await db.sequelize.transaction(async (t) => {
          // =========================
          // 1) ลบ user ที่ไม่อยู่ใน API แล้ว (เฉพาะ group_name นี้) ยกเว้น Admin01
          // =========================
          const whereMissing =
            apiUsernames.length > 0
              ? {
                  group_name: g.name,
                  username: {
                    [Op.and]: [{ [Op.ne]: SPECIAL_ID }, { [Op.notIn]: apiUsernames }],
                  },
                }
              : {
                  group_name: g.name,
                  username: { [Op.ne]: SPECIAL_ID },
                };

          const missingRows = await User.findAll({
            where: whereMissing,
            attributes: ["id"],
            transaction: t,
            lock: t.LOCK.UPDATE,
          });

          if (missingRows.length > 0) {
            const ids = missingRows.map((r) => r.id);
            await User.destroy({
              where: { id: { [Op.in]: ids } },
              transaction: t,
            });
            deletedMissing += ids.length;
          }

          // =========================
          // 2) Upsert user จาก API + ลบ duplicate username (ถ้ามี)
          // =========================
          for (const apiUser of users) {
            const username = (apiUser?.username || "").trim();
            if (!username) continue;

            // ❌ ไม่แตะ Admin01
            if (username === SPECIAL_ID) continue;

            const payload = {
              firstname: apiUser?.fname ?? "",
              lastname: apiUser?.lname ?? "",
              username,
              email: apiUser?.email ?? "",
              phone: apiUser?.phone ?? "",
              position: apiUser?.position ?? "",
              group_name: g.name,
              ai_access: g.status,
              login_type: "NORMAL",
            };

            const found = await User.findAll({
              where: { username },
              order: [["id", "ASC"]],
              transaction: t,
              lock: t.LOCK.UPDATE,
            });

            let userRow = found[0] || null;

            // ลบ duplicate (เหลือแถวแรก)
            if (found.length > 1) {
              const dupIds = found.slice(1).map((u) => u.id);
              await User.destroy({
                where: { id: { [Op.in]: dupIds } },
                transaction: t,
              });
              deletedDup += dupIds.length;
            }

            const isNewUser = !userRow;

            if (!userRow) {
              userRow = await User.create(payload, { transaction: t }); // ✅ id auto
              created++;
            } else {
              await User.update(payload, {
                where: { id: userRow.id },
                transaction: t,
              });
              updated++;
            }

            // =========================
            // 3) สร้าง user_role (role = "เจ้าหน้าที่") ถ้ายังไม่มี
            // =========================
            // ✅ บันทึก role เฉพาะ "ครั้งแรก" (user ใหม่)
            if (isNewUser) {
              const existingUserRole = await User_role.findOne({
                where: { user_id: userRow.id, role_id: roleIdForGroup },
                transaction: t,
                lock: t.LOCK.UPDATE,
              });

              if (!existingUserRole) {
                await User_role.create(
                  { user_id: userRow.id, role_id: roleIdForGroup },
                  { transaction: t }
                );
                userRoleCreated++;
              }
            }

            // =========================
            // 4) sync user_ai ตาม group_ai ของกลุ่มนี้
            //    - user ใหม่: create token ตาม init_token
            //    - user เก่า: ไม่ update token (แต่ถ้าไม่มี record ให้ create)
            // =========================
            for (const ga of groupAis) {
              const aiId = Number(ga.ai_id);
              const initToken = Number(ga.init_token ?? 0);

              const ua = await User_ai.findOne({
                where: { user_id: userRow.id, ai_id: aiId },
                transaction: t,
                lock: t.LOCK.UPDATE,
              });

              if (!ua) {
                // ✅ ถ้าไม่มี record -> สร้าง
                await User_ai.create(
                  {
                    user_id: userRow.id,
                    ai_id: aiId,
                    token_count: initToken,
                    token_all: initToken,
                    is_notification: false,
                  },
                  { transaction: t }
                );
                userAiCreated++;
              } else {
                // ✅ มีอยู่แล้ว:
                // - user ใหม่: ปกติจะเพิ่งสร้าง record ใหม่อยู่แล้ว (แต่ถ้ามีอยู่ก็ไม่ต้องแก้)
                // - user เก่า: "ห้าม update token" ตาม requirement
                // do nothing
                if (isNewUser) {
                  // do nothing
                }
              }
            }
          }
        });
      } catch (err) {
        // ✅ ถ้า ONESQA ล่ม -> ต้อง throw ออกไปทันที
        if (err?.message === "ระบบ ONESQA ไม่พร้อมใช้งาน") throw err;

        // console.error(`❌ group_api_id=${g.group_api_id} (${g.name}) error:`, err.message);
        if (err.response) {
          // console.error("response data:", err.response.data);
        }
      }
    }

    // console.log("✅ sync summary:", {
    //   created,
    //   updated,
    //   deletedDup,
    //   deletedMissing,
    //   userRoleCreated,
    //   userAiCreated,
    // });
  } catch (err) {
    // ✅ ถ้า ONESQA ล่ม -> ต้อง throw ออกไปทันที
    if (err?.message === "ระบบ ONESQA ไม่พร้อมใช้งาน") throw err;

    // console.error("❌ main error:", err.message);
    if (err.response) {
      // console.error("response data:", err.response.data);
    }
  }

  // ส่วนของข้อมูล ผู้ประเมินภายนอก
  try {
    const groupAis = await Group_ai.findAll({
      where: { group_id: assessorGroup.id },
      attributes: ["ai_id", "init_token"],
      raw: true,
    });

    // ✅ หา role_id ของ "ผู้ประเมินภายนอก"
    const assessorRole = await Role.findOne({
      where: { role_name_th: assessorRoleName },
      attributes: ["id"],
      raw: true,
    });
    const assessorRoleId = assessorRole.id;

    assessorApiCount += assessors.length;

    // -------------------------------
    // 2) เตรียม username จาก assessor
    // ใช้ id_card เป็นหลัก (เสถียร/ไม่ซ้ำ) ถ้าไม่มีค่อย fallback
    // -------------------------------
    const toUsername = (a) => {
      const idCard = (a?.id_card || "").trim();
      if (idCard) return idCard;
      const email = (a?.email || "").trim();
      if (email) return email;
      const badge = (a?.badge_no || "").trim();
      if (badge) return badge;
      return `assessor_${a?.id ?? Math.random().toString(36).slice(2)}`;
    };

    const apiUsernames = assessors
      .map((a) => toUsername(a))
      .filter((u) => u && u !== SPECIAL_ID); // เผื่อมีหลุดมา

    let created = 0;
    let updated = 0;
    let deletedDup = 0;
    let deletedMissing = 0;
    let userRoleCreated = 0;
    let userAiCreated = 0;

    // -------------------------------
    // 3) Sync ลง DB (เหมือน flow ก่อนหน้า)
    // -------------------------------
    await db.sequelize.transaction(async (t) => {
      // 3.1) ลบ user ที่ไม่อยู่ใน API แล้ว (เฉพาะกลุ่มผู้ประเมินภายนอก) ยกเว้น Admin01
      const whereMissing =
        apiUsernames.length > 0
          ? {
              group_name: assessorGroupName,
              username: {
                [Op.and]: [{ [Op.ne]: SPECIAL_ID }, { [Op.notIn]: apiUsernames }],
              },
            }
          : {
              group_name: assessorGroupName,
              username: { [Op.ne]: SPECIAL_ID },
            };

      const missingRows = await User.findAll({
        where: whereMissing,
        attributes: ["id"],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (missingRows.length > 0) {
        const ids = missingRows.map((r) => r.id);
        await User.destroy({
          where: { id: { [Op.in]: ids } },
          transaction: t,
        });
        deletedMissing += ids.length;
      }

      // 3.2) upsert assessor ทีละคน
      for (const a of assessors) {
        const username = toUsername(a);
        if (!username) continue;
        if (username === SPECIAL_ID) continue; // ❌ ไม่แตะ

        const payload = {
          firstname: a?.name ?? "",
          lastname: a?.lastname ?? "",
          username,
          email: a?.email ?? "",
          phone: a?.tel ?? "",
          group_name: assessorGroupName,
          ai_access: assessorGroup?.status,
          login_type: "INSPEC", // ถ้าต้องการแยกผู้ประเมินเป็น INSPEC เปลี่ยนเป็น "INSPEC"
          position: "",
        };

        // กันเคส username ซ้ำหลายแถว
        const found = await User.findAll({
          where: { username },
          order: [["id", "ASC"]],
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        let userRow = found[0] || null;

        if (found.length > 1) {
          const dupIds = found.slice(1).map((u) => u.id);
          await User.destroy({
            where: { id: { [Op.in]: dupIds } },
            transaction: t,
          });
          deletedDup += dupIds.length;
        }

        const isNewUser = !userRow;

        if (!userRow) {
          userRow = await User.create(payload, { transaction: t });
          created++;
        } else {
          await User.update(payload, {
            where: { id: userRow.id },
            transaction: t,
          });
          updated++;
        }

        // 3.3) สร้าง user_role = ผู้ประเมินภายนอก ถ้ายังไม่มี
        // ✅ role: ทำเฉพาะ "user ใหม่" เท่านั้น (คนเดิมไม่แตะ role)
        if (isNewUser) {
          const existingUserRole = await User_role.findOne({
            where: { user_id: userRow.id, role_id: assessorRoleId },
            transaction: t,
            lock: t.LOCK.UPDATE,
          });

          if (!existingUserRole) {
            await User_role.create(
              { user_id: userRow.id, role_id: assessorRoleId },
              { transaction: t }
            );
            userRoleCreated++;
          }
        }

        // 3.4) user_ai: ถ้า user ใหม่ -> create token ตาม init_token
        //     ถ้า user เก่า -> "ไม่ update token" (แต่ถ้าไม่มี record ให้ create)
        for (const ga of groupAis) {
          const aiId = Number(ga.ai_id);
          const initToken = Number(ga.init_token ?? 0);

          const ua = await User_ai.findOne({
            where: { user_id: userRow.id, ai_id: aiId },
            transaction: t,
            lock: t.LOCK.UPDATE,
          });

          if (!ua) {
            await User_ai.create(
              {
                user_id: userRow.id,
                ai_id: aiId,
                token_count: initToken,
                token_all: initToken,
                is_notification: false,
              },
              { transaction: t }
            );
            userAiCreated++;
          } else {
            // ✅ มีอยู่แล้ว: ไม่ update token ตาม requirement (ทั้ง user ใหม่/เก่า)
            // do nothing
            if (isNewUser) {
              // do nothing
            }
          }
        }
      }
    });

    // console.log("✅ assessor sync summary:", {
    //   fetched: assessors.length,
    //   created,
    //   updated,
    //   deletedDup,
    //   deletedMissing,
    //   userRoleCreated,
    //   userAiCreated,
    // });
  } catch (err) {
    // ✅ ถ้า ONESQA ล่ม -> ต้อง throw ออกไปทันที
    if (err?.message === "ระบบ ONESQA ไม่พร้อมใช้งาน") throw err;

    // console.error("❌ assessor sync error:", err.message);
    if (err.response) {
      // console.error("response data:", err.response.data);
    }
  }

    // 🔢 นับจำนวน user ทั้งหมดจริงจากระบบ
  const totalUser = staffApiCount + assessorApiCount;

  // ✅ บันทึกแบบรายวัน + backfill วันที่ขาด
  await upsertUserCountDaily(totalUser);

  return {
    totalUsersFromApis: totalUser,
    staffApiCount,
    assessorApiCount,
  };
};
