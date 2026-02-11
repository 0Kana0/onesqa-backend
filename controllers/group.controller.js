const moment = require("moment-timezone");
const { Op, fn, col, QueryTypes } = require("sequelize"); // ✅ เพิ่ม QueryTypes
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Group, Ai, User, User_role, Group_ai, User_token, User_ai } = db;
const sequelize = db.sequelize;
const { auditLog } = require("../utils/auditLog"); // ปรับ path ให้ตรง
const { notifyUser } = require("../utils/notifier");
const { getLocale, getCurrentUser } = require("../utils/currentUser");

const TZ = "Asia/Bangkok";

exports.listGroups = async ({ page, pageSize, where: filters = {} } = {}) => {
  // =========================
  // 0) เวลา today / month (TH) — ใช้ used_date
  // =========================
  const nowTH = moment.tz(TZ);
  const startOfMonthTH = nowTH.clone().startOf("month"); // ✅ fix

  const usedDateToday = nowTH.format("YYYY-MM-DD");
  const startOfMonthStr = startOfMonthTH.format("YYYY-MM-DD");
  const startOfNextMonthStr = startOfMonthTH.clone().add(1, "month").format("YYYY-MM-DD");

  const daysElapsed = nowTH.diff(startOfMonthTH, "days") + 1;

  // =========================
  // 1) where ของ Group
  // =========================
  const groupWhere = {};
  const { search, model_use_name, ...rest } = filters || {};

  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) groupWhere[k] = v;
  }

  if (search && String(search).trim()) {
    const keyword = `%${String(search).trim()}%`;
    groupWhere[Op.or] = [{ name: { [Op.like]: keyword } }];
  }

  // =========================
  // 2) include ของ Ai (default model ของ group)
  // =========================
  const aiInclude = {
    model: Ai,
    as: "ai",
    attributes: ["id", "model_name", "model_use_name", "model_type", "message_type"],
    required: false,
  };

  if (model_use_name && String(model_use_name).trim()) {
    const keyword = `%${String(model_use_name).trim()}%`;
    aiInclude.where = { model_use_name: { [Op.like]: keyword } };
    aiInclude.required = true;
  }

  // =========================
  // 3) pagination
  // =========================
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Number(pageSize) || 10);
  const offset = (safePage - 1) * safePageSize;

  // =========================
  // 4) query groups
  // =========================
  const { rows, count } = await Group.findAndCountAll({
    where: groupWhere,
    include: [
      aiInclude,
      {
        model: Group_ai,
        as: "group_ai",
        attributes: ["id", "ai_id", "init_token", "createdAt", "updatedAt"],
        include: [
          {
            model: Ai,
            as: "ai",
            attributes: ["id", "model_name", "model_use_name", "model_type", "message_type"],
            required: false,
          },
        ],
        required: false,
      },
    ],
    order: [["id", "ASC"]],
    limit: safePageSize,
    offset,
    distinct: true,
  });

  // =========================
  // 5) รวม token ของทุก user ในกลุ่มนั้น แยกตาม model
  //    5.1 today/month จาก User_token.total_token (อิง used_date)
  //    5.2 token_count/token_all จาก User_ai
  //    5.3 user_count (จำนวน user ต่อ group)
  // =========================
  const groupNames = [...new Set(rows.map((g) => g?.name).filter(Boolean))];

  let todayAgg = [];
  let monthAgg = [];
  let userAiAgg = [];
  let userCountAgg = []; // ✅ เพิ่ม

  if (groupNames.length) {
    // --- today (SUM total_token) ---
    todayAgg = await User_token.findAll({
      attributes: [
        [col("user.group_name"), "group_name"],
        [col("ai.model_use_name"), "model_use_name"],
        [fn("COALESCE", fn("SUM", col("User_token.total_token")), 0), "tokens_today"],
      ],
      include: [
        {
          model: User,
          as: "user",
          attributes: [],
          required: true,
          where: { group_name: { [Op.in]: groupNames } },
        },
        { model: Ai, as: "ai", attributes: [], required: false },
      ],
      where: { used_date: usedDateToday },
      group: [col("user.group_name"), col("ai.model_use_name")],
      raw: true,
    });

    // --- month (SUM total_token) ---
    monthAgg = await User_token.findAll({
      attributes: [
        [col("user.group_name"), "group_name"],
        [col("ai.model_use_name"), "model_use_name"],
        [fn("COALESCE", fn("SUM", col("User_token.total_token")), 0), "tokens_month"],
      ],
      include: [
        {
          model: User,
          as: "user",
          attributes: [],
          required: true,
          where: { group_name: { [Op.in]: groupNames } },
        },
        { model: Ai, as: "ai", attributes: [], required: false },
      ],
      where: {
        used_date: { [Op.gte]: startOfMonthStr, [Op.lt]: startOfNextMonthStr },
      },
      group: [col("user.group_name"), col("ai.model_use_name")],
      raw: true,
    });

    // --- token_count / token_all (SUM จาก User_ai ของทุก user ในกลุ่มนั้น) ---
    userAiAgg = await User_ai.findAll({
      attributes: [
        [col("user.group_name"), "group_name"],
        [col("ai.model_use_name"), "model_use_name"],
        [fn("COALESCE", fn("SUM", col("User_ai.token_count")), 0), "token_count_sum"],
        [fn("COALESCE", fn("SUM", col("User_ai.token_all")), 0), "token_all_sum"],
      ],
      include: [
        {
          model: User,
          as: "user",
          attributes: [],
          required: true,
          where: { group_name: { [Op.in]: groupNames } },
        },
        { model: Ai, as: "ai", attributes: [], required: true },
      ],
      group: [col("user.group_name"), col("ai.model_use_name")],
      raw: true,
    });

    // ✅ --- user_count (COUNT users per group_name) ---
    // หมายเหตุ: นับจากตาราง user โดยตรง (อิง user.group_name)
    userCountAgg = await User.findAll({
      attributes: [
        ["group_name", "group_name"],
        [fn("COUNT", col("User.id")), "user_count"],
      ],
      where: {
        group_name: { [Op.in]: groupNames },
      },
      group: ["group_name"],
      raw: true,
    });
  }

  const todayMap = new Map(
    todayAgg.map((r) => [
      `${String(r.group_name)}|${String(r.model_use_name)}`,
      Number(r.tokens_today) || 0,
    ])
  );

  const monthMap = new Map(
    monthAgg.map((r) => [
      `${String(r.group_name)}|${String(r.model_use_name)}`,
      Number(r.tokens_month) || 0,
    ])
  );

  const userAiMap = new Map(
    userAiAgg.map((r) => [
      `${String(r.group_name)}|${String(r.model_use_name)}`,
      {
        token_count: Number(r.token_count_sum) || 0,
        token_all: Number(r.token_all_sum) || 0,
      },
    ])
  );

  const userCountMap = new Map(
    userCountAgg.map((r) => [String(r.group_name), Number(r.user_count) || 0])
  );

  // =========================
  // 6) ใส่ models + user_count ให้แต่ละ group
  // =========================
  const items = rows.map((g) => {
    const group = g.toJSON ? g.toJSON() : g;
    const name = group.name;

    // ✅ user_count ต่อ group
    const user_count = userCountMap.get(name) ?? 0;

    // รวมรายชื่อโมเดลที่ group มี (กันซ้ำด้วย model_use_name)
    const modelMap = new Map();

    // default model ของ group
    if (group.ai?.model_use_name) {
      modelMap.set(group.ai.model_use_name, {
        ...group.ai,
        init_token: null,
      });
    }

    // models จาก group_ai
    for (const ga of group.group_ai || []) {
      if (ga?.ai?.model_use_name) {
        modelMap.set(ga.ai.model_use_name, {
          ...ga.ai,
          init_token: ga.init_token ?? null,
        });
      }
    }

    const models = [...modelMap.values()].map((m) => {
      const key = `${name}|${m.model_use_name}`;

      const tokensToday = todayMap.get(key) ?? 0;
      const tokensMonth = monthMap.get(key) ?? 0;
      const average = daysElapsed > 0 ? Math.round(tokensMonth / daysElapsed) : 0;

      const ua = userAiMap.get(key) ?? { token_count: 0, token_all: 0 };

      return {
        ...m,
        ai_id: m.id,

        today: tokensToday,
        average,

        token_count: ua.token_count,
        token_all: ua.token_all,

        ai: {
          model_name: m.model_name,
          model_use_name: m.model_use_name,
          model_type: m.model_type,
        },
      };
    });

    // ✅ เพิ่ม user_count ใน response ของ group
    return { ...group, user_count, models };
  });

  return {
    items,
    page: safePage,
    pageSize: safePageSize,
    totalCount: count,
  };
};

exports.getGroupById = async (id) => {
  return await Group.findByPk(id, {
    include: [
      {
        model: Ai,
        as: "ai",
        attributes: ["id", "model_name", "model_use_name", "model_type", "message_type"],
        required: false,
      },
      {
        model: Group_ai,
        as: "group_ai",
        attributes: ["id", "ai_id", "init_token"],
        include: [
          {
            model: Ai,
            as: "ai",
            attributes: ["id", "model_name", "model_use_name", "model_type", "message_type"],
          },
        ],
        required: false,
      },
    ],
  });
};

exports.getGroupByName = async (name) => {
  return await Group.findOne({
    where: { name }, // หรือ { group_name: name }
    include: [
      {
        model: Ai,
        as: "ai",
        attributes: ["id", "model_name", "model_use_name", "model_type", "message_type"],
        required: false,
      },
      {
        model: Group_ai,
        as: "group_ai",
        attributes: ["id", "ai_id", "init_token"],
        include: [
          {
            model: Ai,
            as: "ai",
            attributes: ["id", "model_name", "model_use_name", "model_type", "message_type"],
          },
        ],
        required: false,
      },
    ],
  });
};

exports.getAllGroupsWithUserCount = async () => {
  const sql = `
    SELECT
      g.id,
      g.name,
      g.code,
      COUNT(u.id)::int AS user_count
    FROM "group" g
    LEFT JOIN "user" u
      ON u."group_name" = g.name
    GROUP BY g.id, g.name, g.code
    ORDER BY user_count DESC, g.id ASC;
  `;

  // ถ้า user.group_name เก็บเป็น code ให้แก้ ON เป็น:
  // ON u."group_name" = g.code

  return sequelize.query(sql, { type: QueryTypes.SELECT });
}

exports.updateGroup = async (id, input, ctx) => {
  const locale = await getLocale(ctx);

  // console.log("input", input);

  // ===== helpers =====
  const fmt = (v) =>
    v === null || v === undefined ? "-" : Number(v).toLocaleString();

  // ✅ robust status mapper (รองรับ true/false, 1/0, "active"/"inactive", ไทย ฯลฯ)
  const toStatusKey = (v) => {
    if (v === null || v === undefined) return null;

    if (typeof v === "boolean") return v ? "active" : "inactive";
    if (typeof v === "number") return v === 1 ? "active" : v === 0 ? "inactive" : String(v);

    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      const activeSet = new Set(["true", "1", "yes", "y", "active", "enabled", "enable", "on", "ใช้งาน", "ใช้งานอยู่"]);
      const inactiveSet = new Set(["false", "0", "no", "n", "inactive", "disabled", "disable", "off", "ไม่ใช้งาน", "ไม่ใช้งานอยู่"]);

      if (activeSet.has(s)) return "active";
      if (inactiveSet.has(s)) return "inactive";
      return v; // fallback เป็น string เดิม
    }

    return String(v);
  };

  const statusLabel = (val, lang = "th") => {
    const key = toStatusKey(val);
    if (key === "active") return lang === "th" ? "อนุมัติ" : "Active";
    if (key === "inactive") return lang === "th" ? "ไม่อนุมัติ" : "Inactive";
    if (key === null) return "-";
    return String(key);
  };

  const getAdminUsers = async () => {
    return await User.findAll({
      attributes: ["id", "email", "locale", "loginAt"],
      include: [
        {
          model: User_role,
          as: "user_role",
          where: { role_id: { [Op.in]: [3, 4] } },
          attributes: [],
        },
      ],
    });
  };

  // ===== validate input =====
  const { group_ai, model_use_name, ...groupFields } = input || {};

  if (Array.isArray(group_ai)) {
    for (const ga of group_ai) {
      if (ga.init_token != null && ga.init_token < 0)
        throw new Error(locale === "th" ? "init_token ต้องมากกว่า 0" : "init_token must be greater than 0");
      if (ga.plus_token != null && ga.plus_token < 0)
        throw new Error(locale === "th" ? "plus_token ต้องมากกว่า 0" : "plus_token must be greater than 0");
      if (ga.minus_token != null && ga.minus_token < 0)
        throw new Error(locale === "th" ? "minus_token ต้องมากกว่า 0" : "minus_token must be greater than 0");
    }
  }

  // ===== events to fire AFTER COMMIT =====
  const events = [];

  // =======================
  // PHASE 1 : DB TRANSACTION
  // =======================
  const snapshot = await Group.sequelize.transaction(async (t) => {
    // lock row ป้องกัน concurrent update
    const row = await Group.findByPk(id, {
      transaction: t,
    });

    if (!row) {
      throw new Error(locale === "th" ? "ไม่พบกลุ่ม" : "Group not found");
    }

    // load group_ai แบบเบา
    const existingGroupAis = await Group_ai.findAll({
      where: { group_id: id },
      include: [
        {
          model: Ai,
          as: "ai",
          attributes: ["id", "model_use_name"],
          required: false,
        },
      ],
      transaction: t,
    });

    // ---------- detect default model change ----------
    if (
      groupFields?.ai_id !== undefined &&
      Number(row.ai_id) !== Number(groupFields.ai_id)
    ) {
      events.push({
        type: "MODEL_CHANGED",
        groupName: row.name,
        oldModel: row.ai_id,
        newModel: groupFields.ai_id,
        oldName: row.model_use_name ?? "-",
        newName: model_use_name ?? "-",
      });
    }

    // ✅ ---------- detect status change ----------
    // หมายเหตุ: ใช้ groupFields.status เป็นหลัก (ถ้าคุณใช้ field ชื่ออื่น เช่น activity ก็เปลี่ยนตรงนี้ได้)
    if (groupFields?.status !== undefined) {
      const oldKey = toStatusKey(row.status);
      const newKey = toStatusKey(groupFields.status);

      // เปรียบเทียบแบบ normalize แล้ว
      if (String(oldKey) !== String(newKey)) {
        events.push({
          type: "STATUS_CHANGED",
          groupName: row.name,
          oldValue: row.status,
          newValue: groupFields.status,
        });
      }
    }

    // ---------- detect init_token change ----------
    if (Array.isArray(group_ai)) {
      const existingByAi = new Map(
        existingGroupAis.map((ga) => [Number(ga.ai_id), ga])
      );

      const inputByAi = new Map();
      for (const it of group_ai) {
        const key = Number(it.ai_id);
        if (!inputByAi.has(key)) inputByAi.set(key, it);
      }

      for (const [aiId, oldData] of existingByAi.entries()) {
        const newData = inputByAi.get(aiId);
        if (!newData) continue;

        if (
          newData.init_token !== undefined &&
          oldData.init_token !== newData.init_token
        ) {
          events.push({
            type: "INIT_TOKEN_CHANGED",
            groupName: row.name,
            modelName: oldData.ai?.model_use_name ?? `AI:${aiId}`,
            oldValue: oldData.init_token,
            newValue: newData.init_token,
          });
        }
      }
    }

    // ---------- เพิ่ม/ลด token ของผู้ใช้านในกลุ่ม ----------
    if (Array.isArray(group_ai)) {
      const existingByAi = new Map(
        existingGroupAis.map((ga) => [Number(ga.ai_id), ga])
      );

      const inputByAi = new Map();
      for (const it of group_ai) {
        const key = Number(it.ai_id);
        if (!inputByAi.has(key)) inputByAi.set(key, it);
      }

      for (const [aiId, oldData] of existingByAi.entries()) {
        const newData = inputByAi.get(aiId);
        if (!newData) continue;

        const result_token = newData.plus_token - newData.minus_token;

        // มีอันใดอันนึงมากกว่า 0 และ ผลรวมทั้งสองไม่เท่ากับ 0
        if (
          (newData.plus_token !== 0 || newData.minus_token !== 0) &&
          result_token !== 0
        ) {
          // console.log("groupName", row.name);
          // console.log("modelName", oldData.ai?.model_use_name);
          // console.log("plus_token", newData.plus_token);
          // console.log("minus_token", newData.minus_token);

          // 1) หา user ids ในกลุ่มนี้
          const users = await User.findAll({
            where: { group_name: row.name },
            attributes: ["id"],
            raw: true,
          });
          const userIds = users.map((u) => u.id);

          // ถ้าต้องการเติม token
          if (result_token > 0) {
            // จำนวน token ทั้งหมดที่เหลืออยู่
            const aiData = await Ai.findByPk(Number(aiId));

            // จำนวน token ทั้งหมดที่ได้เเจกจ่ายไปแล้ว
            const allUseToken = await User_ai.sum("token_count", {
              where: {
                ai_id: aiId,
                token_count: { [Op.ne]: 0 },
              },
            });

            // ถ้าจำนวน token ทั้งหมดที่ได้เเจกจ่ายไปแล้ว + ผลคูณของ token ที่จะเพิ่มกับจำนวนผู้ใช้งาน มากกว่า จำนวน token ทั้งหมดที่เหลืออยู่ ให้ throw error
            if (allUseToken + (result_token * users.length) >= aiData.token_count) {
              throw new Error(
                locale === "th"
                  ? "จำนวน token ที่เหลืออยู่ไม่เพียงพอ"
                  : "Insufficient remaining tokens"
              );
            }

            // 2) bulk update user_ai
            const [affectedRows] = await User_ai.update({
              token_count: User_ai.sequelize.literal(`COALESCE(token_count, 0) + (${result_token})`),
              token_all: User_ai.sequelize.literal(`COALESCE(token_count, 0) + (${result_token})`),
            }, {
              where: {
                ai_id: aiId,
                user_id: { [Op.in]: userIds },
              },
            });

          // ถ้าต้องการลด token
          } else if (result_token < 0) {
            // 2) bulk update user_ai
            const [affectedRows] = await User_ai.update({
              token_count: User_ai.sequelize.literal(`GREATEST(COALESCE(token_count, 0) + (${result_token}), 0)`),
              token_all: User_ai.sequelize.literal(`GREATEST(COALESCE(token_count, 0) + (${result_token}), 0)`),
            }, {
              where: {
                ai_id: aiId,
                user_id: { [Op.in]: userIds },
              },
            });
          }

          events.push({
            type: "PLUSMINUS_TOKEN_CHANGED",
            groupName: row.name,
            aiId: aiId,
            modelName: oldData.ai?.model_use_name ?? `AI:${aiId}`,
            result_token: result_token
          });
        }
      }
    }

    // ---------- update Group ----------
    if (Object.keys(groupFields || {}).length) {
      await row.update(groupFields, { transaction: t });
    }

    // ---------- upsert group_ai ----------
    if (Array.isArray(group_ai)) {
      const existingByAi = new Map(
        existingGroupAis.map((ga) => [Number(ga.ai_id), ga])
      );

      const inputByAi = new Map();
      for (const it of group_ai) {
        const key = Number(it.ai_id);
        if (!inputByAi.has(key)) inputByAi.set(key, it);
      }

      for (const [aiId, it] of inputByAi.entries()) {
        const oldData = existingByAi.get(aiId);
        const newInit = it.init_token ?? null;

        if (!oldData) {
          await Group_ai.create(
            {
              group_id: id,
              ai_id: aiId,
              init_token: newInit,
            },
            { transaction: t }
          );
        } else if (oldData.init_token !== newInit) {
          await oldData.update({ init_token: newInit }, { transaction: t });
        }
      }

      // delete ตัวที่หายไป
      for (const [aiId, oldData] of existingByAi.entries()) {
        if (!inputByAi.has(aiId)) {
          await oldData.destroy({ transaction: t });
        }
      }
    }

    return {
      groupId: id,
      groupName: row.name,
    };
  });

  // =======================
  // PHASE 2 : AFTER COMMIT
  // =======================
  if (events.length) {
    const adminUsers = await getAdminUsers();

    for (const ev of events) {
      if (ev.type === "MODEL_CHANGED") {
        // audit
        await auditLog({
          ctx,
          locale: "th",
          log_type: "GROUP",
          old_data: `Model เริ่มต้นของกลุ่มผู้ใช้งาน (${ev.groupName}) ${ev.oldName}`,
          new_data: `Model เริ่มต้นของกลุ่มผู้ใช้งาน (${ev.groupName}) ${ev.newName}`,
          old_status: null,
          new_status: null,
        });

        await auditLog({
          ctx,
          locale: "en",
          log_type: "GROUP",
          old_data: `Default model for user group (${ev.groupName}) ${ev.oldName}`,
          new_data: `Default model for user group (${ev.groupName}) ${ev.newName}`,
          old_status: null,
          new_status: null,
        });

        for (const admin of adminUsers) {
          await notifyUser({
            locale: "th",
            recipient_locale: admin.locale,
            loginAt: admin.loginAt,
            userId: admin.id,
            title: "เเจ้งเตือนตั้งค่ากลุ่มผู้ใช้งาน",
            message: `Model เริ่มต้นของกลุ่มผู้ใช้งาน (${ev.groupName}) จาก ${ev.oldName} เป็น ${ev.newName}`,
            type: "INFO",
            to: admin.email,
          });

          await notifyUser({
            locale: "en",
            recipient_locale: admin.locale,
            loginAt: admin.loginAt,
            userId: admin.id,
            title: "User Group Settings Notification",
            message: `The default model for user group (${ev.groupName}) has been changed from ${ev.oldName} to ${ev.newName}.`,
            type: "INFO",
            to: admin.email,
          });
        }
      }

      // ✅ STATUS_CHANGED (เพิ่มใหม่)
      if (ev.type === "STATUS_CHANGED") {
        const userInGroups = await User.findAll({
          attributes: ["id", "email", "locale", "loginAt"],
          where: { group_name: ev.groupName },
        });

        // เเก้ไข ai_access ของ user ทั้งหมดใน group_name
        const edituser = await User.update(
          { ai_access: ev.newValue },
          { where: { group_name: ev.groupName } }
        )

        const oldTh = statusLabel(ev.oldValue, "th");
        const newTh = statusLabel(ev.newValue, "th");
        const oldEn = statusLabel(ev.oldValue, "en");
        const newEn = statusLabel(ev.newValue, "en");

        await auditLog({
          ctx,
          locale: "th",
          log_type: "GROUP",
          old_data: `กำหนด AI Access ของกลุ่มผู้ใช้งาน (${ev.groupName})`,
          new_data: `กำหนด AI Access ของกลุ่มผู้ใช้งาน (${ev.groupName})`,
          old_status: ev.oldValue,
          new_status: ev.newValue,
        });

        await auditLog({
          ctx,
          locale: "en",
          log_type: "GROUP",
          old_data: `Set AI Access for user group (${ev.groupName})`,
          new_data: `Set AI Access for user group (${ev.groupName})`,
          old_status: ev.oldValue,
          new_status: ev.newValue,
        });

        for (const admin of adminUsers) {
          await notifyUser({
            locale: "th",
            recipient_locale: admin.locale,
            loginAt: admin.loginAt,
            userId: admin.id,
            title: "เเจ้งเตือนตั้งค่ากลุ่มผู้ใช้งาน",
            message: `กำหนด AI Access ของกลุ่มผู้ใช้งาน (${ev.groupName}) จาก ${oldTh} เป็น ${newTh}`,
            type: "INFO",
            to: admin.email,
          });

          await notifyUser({
            locale: "en",
            recipient_locale: admin.locale,
            loginAt: admin.loginAt,
            userId: admin.id,
            title: "User Group Settings Notification",
            message: `AI access for user group (${ev.groupName}) has been changed from ${oldEn} to ${newEn}.`,
            type: "INFO",
            to: admin.email,
          });
        }

        for (const user of userInGroups) {
          await notifyUser({
            locale: "th",
            recipient_locale: user.locale,
            loginAt: user.loginAt,
            userId: user.id,
            title: "เเจ้งเตือนตั้งค่ากลุ่มผู้ใช้งาน",
            message: `กำหนด AI Access ของกลุ่มผู้ใช้งาน (${ev.groupName}) จาก ${oldTh} เป็น ${newTh}`,
            type: "INFO",
            to: user.email,
          });

          await notifyUser({
            locale: "en",
            recipient_locale: user.locale,
            loginAt: user.loginAt,
            userId: user.id,
            title: "User Group Settings Notification",
            message: `AI access for user group (${ev.groupName}) has been changed from ${oldEn} to ${newEn}.`,
            type: "INFO",
            to: user.email,
          });
        }
      }

      if (ev.type === "INIT_TOKEN_CHANGED") {
        await auditLog({
          ctx,
          locale: "th",
          log_type: "GROUP",
          old_data: `จำนวน Token เริ่มต้นของ Model (${ev.modelName}) ของกลุ่มผู้ใช้งาน (${ev.groupName}) ${fmt(ev.oldValue)}`,
          new_data: `จำนวน Token เริ่มต้นของ Model (${ev.modelName}) ของกลุ่มผู้ใช้งาน (${ev.groupName}) ${fmt(ev.newValue)}`,
          old_status: null,
          new_status: null,
        });

        await auditLog({
          ctx,
          locale: "en",
          log_type: "GROUP",
          old_data: `Initial token amount for model (${ev.modelName}) in user group (${ev.groupName}) ${fmt(ev.oldValue)}`,
          new_data: `Initial token amount for model (${ev.modelName}) in user group (${ev.groupName}) ${fmt(ev.newValue)}`,
          old_status: null,
          new_status: null,
        });

        for (const admin of adminUsers) {
          await notifyUser({
            locale: "th",
            recipient_locale: admin.locale,
            loginAt: admin.loginAt,
            userId: admin.id,
            title: "เเจ้งเตือนตั้งค่ากลุ่มผู้ใช้งาน",
            message: `จำนวน Token เริ่มต้นของ Model (${ev.modelName}) ของกลุ่มผู้ใช้งาน (${ev.groupName}) จาก ${fmt(ev.oldValue)} เป็น ${fmt(ev.newValue)}`,
            type: "INFO",
            to: admin.email,
          });

          await notifyUser({
            locale: "en",
            recipient_locale: admin.locale,
            loginAt: admin.loginAt,
            userId: admin.id,
            title: "User Group Settings Notification",
            message: `The initial token amount for model (${ev.modelName}) in user group (${ev.groupName}) has been changed from ${fmt(ev.oldValue)} to ${fmt(ev.newValue)}.`,
            type: "INFO",
            to: admin.email,
          });
        }
      }

      if (ev.type === "PLUSMINUS_TOKEN_CHANGED") {
        const userInGroups = await User.findAll({
          attributes: ["id", "email", "locale", "loginAt"],
          where: { group_name: ev.groupName },
        });

        for (const user of userInGroups) {

          const user_ai_token = await User_ai.findOne({ 
            attributes: ["token_count"],
            where: { user_id: user.id, ai_id: ev.aiId }
          })

          // console.log("user_ai_token", user_ai_token);

          await notifyUser({
            locale: "th",
            recipient_locale: user.locale,
            loginAt: user.loginAt,
            userId: user.id,
            title: "เเจ้งเตือนตั้งค่า Model ของผู้ใช้งาน",
            message: `จำนวน Token ของ Model (${ev.modelName}) จาก ${(user_ai_token.token_count - ev.result_token).toLocaleString()} เป็น ${user_ai_token.token_count.toLocaleString()}`,
            type: "INFO",
            to: user.email,
          });

          await notifyUser({
            locale: "en",
            recipient_locale: user.locale,
            loginAt: user.loginAt,
            userId: user.id,
            title: "User Model Settings Notification",
            message: `Token count for model (${ev.modelName}) has been changed from ${(user_ai_token.token_count - ev.result_token).toLocaleString()} to ${user_ai_token.token_count.toLocaleString()}.`,
            type: "INFO",
            to: user.email,
          });
        }
      }
    }
  }

  // reload ล่าสุด
  return await Group.findByPk(id, {
    include: [
      {
        model: Ai,
        as: "ai",
        attributes: ["id", "model_name", "model_use_name", "model_type", "message_type"],
      },
      {
        model: Group_ai,
        as: "group_ai",
        attributes: ["id", "ai_id", "init_token"],
        include: [
          {
            model: Ai,
            as: "ai",
            attributes: ["id", "model_name", "model_use_name", "model_type", "message_type"],
          },
        ],
      },
    ],
  });
};

exports.deleteGroup = async (id) => {
  const count = await Group.destroy({ where: { id } });
  return count > 0;
};
