const moment = require("moment-timezone");
const { Op, fn, col } = require("sequelize");
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Group, Ai, User, User_role, Group_ai, User_token, User_ai } = db;
const { auditLog } = require('../utils/auditLog'); // ปรับ path ให้ตรง
const { notifyUser } = require('../utils/notifier');

const TZ = "Asia/Bangkok";

exports.listGroups = async ({ page, pageSize, where: filters = {} } = {}) => {
  // =========================
  // 0) เวลา today / month (TH)
  // =========================
  const nowTH = moment.tz(TZ);
  const startOfToday = nowTH.clone().startOf("day").toDate();
  const startOfTomorrow = nowTH.clone().add(1, "day").startOf("day").toDate();

  const startOfMonthTH = nowTH.clone().startOf("month");
  const startOfMonth = startOfMonthTH.toDate();
  const startOfNextMonth = startOfMonthTH.clone().add(1, "month").toDate();

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
    attributes: ["id", "model_name", "model_use_name", "model_type"],
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
            attributes: ["id", "model_name", "model_use_name", "model_type"],
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
  //    5.1 today/month จาก User_token.total_token
  //    5.2 token_count/token_all จาก User_ai
  // =========================
  const groupNames = [...new Set(rows.map((g) => g?.name).filter(Boolean))];

  let todayAgg = [];
  let monthAgg = [];
  let userAiAgg = [];

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
      where: { createdAt: { [Op.gte]: startOfToday, [Op.lt]: startOfTomorrow } },
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
      where: { createdAt: { [Op.gte]: startOfMonth, [Op.lt]: startOfNextMonth } },
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
        { model: Ai, as: "ai", attributes: [], required: true }, // ต้องมี ai_id เพื่อ map model_use_name
      ],
      group: [col("user.group_name"), col("ai.model_use_name")],
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

  // =========================
  // 6) ใส่ models ให้แต่ละ group
  // =========================
  const items = rows.map((g) => {
    const group = g.toJSON ? g.toJSON() : g;
    const name = group.name;

    // รวมรายชื่อโมเดลที่ group มี (กันซ้ำด้วย model_use_name)
    const modelMap = new Map();

    // default model ของ group
    if (group.ai?.model_use_name) {
      modelMap.set(group.ai.model_use_name, {
        ...group.ai,
        init_token: null, // default model ไม่มี init_token ใน group_ai
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

      // 1) today/average จาก User_token.total_token (รวมทุก user ในกลุ่มนั้น)
      const tokensToday = todayMap.get(key) ?? 0;
      const tokensMonth = monthMap.get(key) ?? 0;
      const average = daysElapsed > 0 ? Math.round(tokensMonth / daysElapsed) : 0;

      // 2) token_count/token_all จาก User_ai (รวมทุก user ในกลุ่มนั้น)
      const ua = userAiMap.get(key) ?? { token_count: 0, token_all: 0 };

      return {
        ...m,
        ai_id: m.id,
        //init_token: m.init_token ?? null,

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

    return { ...group, models };
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
        attributes: ["id", "model_name", "model_use_name", "model_type"],
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
            attributes: ["id", "model_name", "model_use_name", "model_type"],
          },
        ],
        required: false,
      },
    ],
  });
};

exports.updateGroup = async (id, input, ctx) => {
  return await Group.sequelize.transaction(async (t) => {
    const row = await Group.findByPk(id, {
      transaction: t,
      include: [
        {
          model: Ai,
          as: "ai",
          attributes: ["id", "model_name", "model_use_name", "model_type"],
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
              attributes: ["id", "model_name", "model_use_name", "model_type"],
              required: false,
            },
          ],
          required: false,
        },
      ],
    });

    if (!row) throw new Error("Group not found");

    const { group_ai, model_use_name, ...groupFields } = input || {};
    const fmt = (v) =>
      v === null || v === undefined ? "-" : Number(v).toLocaleString();

    const getAdminUsers = async () => {
      return await User.findAll({
        attributes: ["id", "email"],
        include: [
          {
            model: User_role,
            as: "user_role",
            where: { role_id: { [Op.in]: [3, 4] } },
            attributes: [],
          },
        ],
        transaction: t,
      });
    };

    // ---------------- validate init_token ----------------
    if (Array.isArray(group_ai)) {
      for (const ga of group_ai) {
        if (ga.init_token != null && ga.init_token < 0) {
          throw new Error("init_token ต้องมากกว่า 0");
        }
        if (ga.plus_token != null && ga.plus_token < 0) {
          throw new Error('plus_token ต้องมากกว่า 0');
        }
        if (ga.minus_token != null && ga.minus_token < 0) {
          throw new Error('minus_token ต้องมากกว่า 0');
        }
      }
    }

    let isModelChanged = false;
    let isInitTokenChanged = false;

    // ---------------- log & notify การเปลี่ยน Model เริ่มต้น (ai_id บน Group) ----------------
    if (
      groupFields?.ai_id !== undefined &&
      Number(row.ai_id) !== Number(groupFields.ai_id)
    ) {
      isModelChanged = true;

      const oldName = row.ai?.model_use_name ?? "-";
      const newName = model_use_name ?? "-";

      const old_message = `Model เริ่มต้นของกลุ่มผู้ใช้งาน (${row.name}) ${oldName}`;
      const new_message = `Model เริ่มต้นของกลุ่มผู้ใช้งาน (${row.name}) ${newName}`;

      await auditLog({
        ctx,
        log_type: "GROUP",
        old_data: old_message,
        new_data: new_message,
        old_status: null,
        new_status: null,
      });

      const adminUsers = await getAdminUsers();
      for (const admin of adminUsers) {
        await notifyUser({
          userId: admin.id,
          title: "เเจ้งเตือนตั้งค่ากลุ่มผู้ใช้งาน",
          message: `Model เริ่มต้นของกลุ่มผู้ใช้งาน (${row.name}) จาก ${oldName} เป็น ${newName}`,
          type: "INFO",
          to: admin.email,
        });
      }
    }

    // ---------------- log & notify การเปลี่ยน init_token (group_ai) ----------------
    if (Array.isArray(group_ai)) {
      // map ของเดิม
      const existingByAi = new Map(
        (row.group_ai || []).map((ga) => [Number(ga.ai_id), ga])
      );

      // map ของ input (กันซ้ำ ai_id)
      const inputByAi = new Map();
      for (const it of group_ai) {
        const key = Number(it.ai_id);
        if (!inputByAi.has(key)) inputByAi.set(key, it);
      }

      const adminUsers = await getAdminUsers(); // ดึงครั้งเดียว

      // เทียบเฉพาะตัวที่มีเดิมและมีใน input
      for (const [aiId, oldData] of existingByAi.entries()) {
        const newData = inputByAi.get(aiId);
        if (!newData) continue;

        if (newData.init_token !== undefined && oldData.init_token !== newData.init_token) {
          isInitTokenChanged = true;

          const modelName = oldData.ai?.model_use_name ?? `AI:${aiId}`;

          const old_message = `จำนวน Token เริ่มต้นของ Model (${modelName}) ของกลุ่มผู้ใช้งาน (${row.name}) ${fmt(
            oldData.init_token
          )}`;
          const new_message = `จำนวน Token เริ่มต้นของ Model (${modelName}) ของกลุ่มผู้ใช้งาน (${row.name}) ${fmt(
            newData.init_token
          )}`;

          await auditLog({
            ctx,
            log_type: "GROUP",
            old_data: old_message,
            new_data: new_message,
            old_status: null,
            new_status: null,
          });

          for (const admin of adminUsers) {
            await notifyUser({
              userId: admin.id,
              title: "เเจ้งเตือนตั้งค่ากลุ่มผู้ใช้งาน",
              message: `จำนวน Token เริ่มต้นของ Model (${modelName}) ของกลุ่มผู้ใช้งาน (${row.name}) จาก ${fmt(
                oldData.init_token
              )} เป็น ${fmt(newData.init_token)}`,
              type: "INFO",
              to: admin.email,
            });
          }
        }
      }
    }

    // ต้องมีการเปลี่ยน model หรือ init_token ถึงจะเขียน DB
    const allowWrite = isModelChanged || isInitTokenChanged;

    if (!allowWrite) {
      return row;
    }

    // ---------------- update ฟิลด์ Group ปกติ ----------------
    if (Object.keys(groupFields || {}).length) {
      await row.update(groupFields, { transaction: t });
    }

    // ---------------- group_ai: upsert เฉพาะ object ที่มีการเปลี่ยน + ลบตัวที่หายไป ----------------
    if (Array.isArray(group_ai)) {
      const existingByAi = new Map(
        (row.group_ai || []).map((ga) => [Number(ga.ai_id), ga])
      );

      const inputByAi = new Map();
      for (const it of group_ai) {
        const key = Number(it.ai_id);
        if (!inputByAi.has(key)) inputByAi.set(key, it);
      }

      // upsert / update
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
        } else {
          const hasChanged = oldData.init_token !== newInit;
          if (hasChanged) {
            await oldData.update(
              { init_token: newInit },
              { transaction: t }
            );
          }
        }
      }

      // delete ตัวที่มีใน DB แต่ไม่มีใน input
      for (const [aiId, oldData] of existingByAi.entries()) {
        if (!inputByAi.has(aiId)) {
          await oldData.destroy({ transaction: t });
        }
      }
    }

    // ---------------- โหลดกลับพร้อม relation ----------------
    return await Group.findByPk(id, {
      transaction: t,
      include: [
        {
          model: Ai,
          as: "ai",
          attributes: ["id", "model_name", "model_use_name", "model_type"],
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
              attributes: ["id", "model_name", "model_use_name", "model_type"],
              required: false,
            },
          ],
          required: false,
        },
      ],
    });
  });
};

exports.deleteGroup = async (id) => {
  const count = await Group.destroy({ where: { id } });
  return count > 0;
}
