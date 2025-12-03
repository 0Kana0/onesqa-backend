// controllers/user.controller.js
const { Op, fn, col, where: whereFn } = require("sequelize");
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { User, User_role, User_ai, Role, Ai, Chat, Message } = db;
const { auditLog } = require("../utils/auditLog"); // ปรับ path ให้ตรง
const { notifyUser } = require("../utils/notifier"); // ที่ไฟล์ service/controller ของคุณ
const moment = require('moment-timezone');

const TZ = 'Asia/Bangkok';

exports.listUsers = async ({ page, pageSize, where = {} }) => {
  // ป้องกันค่าผิดปกติ
  const limit = Math.min(Math.max(Number(pageSize) || 5, 1), 100);
  const p = Math.max(Number(page) || 1, 1);
  const offset = (p - 1) * limit;

  const { role, status, search  } = where || {};

  // ---------- main where ของตาราง User ----------
  const userWhere = {};
  if (typeof status === "string" && status.trim() !== "") {
    const s = status.trim().toLowerCase();
    if (["ใช้งานอยู่", "true", "1"].includes(s)) userWhere.is_online = true;
    else if (["ไม่ใช้งาน", "false", "0"].includes(s))
      userWhere.is_online = false;
  }

  //console.log(role);
  // 🔎 ค้นหาเฉพาะ "ชื่อ + เว้นวรรค + นามสกุล"
  const full = (search || '').replace(/\s+/g, ' ').trim(); // "${firstname} ${lastname}"
  if (full) {
    userWhere[Op.and] = [
      whereFn(
        fn('concat_ws', ' ', col('firstname'), col('lastname')),
        { [Op.iLike]: `%${full}%` }
      ),
    ];
  }

  // ---------- includes ----------
  // include ฝั่ง role (ถ้ามีตัวกรอง role ให้ required=true เพื่อกรองด้วย join)
  // ถ้ามี role filter => ใช้ INNER JOIN (required: true) ตลอดเส้นทาง
  const includeUserRole = role
    ? {
        model: User_role,
        as: "user_role",
        required: false, // บังคับให้ต้องมีแถว user_role
        include: [
          {
            model: Role,
            as: "role",
            attributes: ["role_name"],
            required: true, // บังคับว่าต้องแมตช์ role ด้วย
            where: { role_name: role }, // กรองตามชื่อ role
          },
        ],
      }
    : {
        model: User_role,
        as: "user_role",
        required: false, // ไม่กรองระดับ user เมื่อไม่มี role filter
        include: [
          {
            model: Role,
            as: "role",
            attributes: ["role_name"],
            required: true, // ทำเป็น INNER JOIN เพื่อไม่ให้ได้ role = null มาใน array
          },
        ],
      };

  const includeUserAi = {
    order: [["ai_id", "ASC"]],
    model: User_ai,
    as: "user_ai",
    required: false,
    include: [
      {
        model: Ai,
        as: "ai",
        attributes: ["model_name", "model_use_name", "model_type"],
        required: false,
      },
    ],
  };

  // ใช้ distinct: true เพื่อให้ count ถูกต้องเวลา join หลายแถว
  const { rows } = await User.findAndCountAll({
    where: userWhere,
    attributes: { exclude: ["password"] },
    include: [includeUserRole, includeUserAi],
    order: [["id", "ASC"]],
    limit,
    offset,
    distinct: true,
  });

  return {
    items: rows,
    page: p,
    pageSize: limit,
    totalCount: rows.length,
  };
};

exports.getByUserId = async (id) => {
  // ---- คำนวณช่วงเวลา (โซนไทย) ----
  const startOfToday     = moment.tz(TZ).startOf('day').toDate();
  const startOfTomorrow  = moment.tz(TZ).add(1, 'day').startOf('day').toDate();
  const startOfMonth     = moment.tz(TZ).startOf('month').toDate();
  const startOfNextMonth = moment.tz(TZ).add(1, 'month').startOf('month').toDate();
  const daysElapsed      = moment.tz(TZ).diff(moment(startOfMonth), 'days') + 1;

  // ---- ดึงข้อมูลผู้ใช้ + สิทธิ์ AI (เหมือนเดิม) ----
  const user = await User.findByPk(id, {
    attributes: { exclude: ['password'] },
    include: [
      {
        model: User_role,
        as: 'user_role',
        include: [
          {
            model: Role,
            as: 'role',
            attributes: ['role_name'],
            required: false,
          },
        ],
      },
      {
        model: User_ai,
        as: 'user_ai',
        // ไม่กำหนด attributes เพื่อให้มี ai_id ติดมาด้วย
        include: [
          {
            order: [["ai_id", "ASC"]],
            model: Ai,
            as: 'ai',
            attributes: ['model_name', 'model_use_name', 'model_type'],
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

  // ---- รวมโทเคน "วันนี้" ต่อ ai_id ของผู้ใช้นี้ ----
  const todayAgg = await Chat.findAll({
    attributes: [
      'ai_id',
      [fn('COALESCE', fn('SUM', col('message.total_token')), 0), 'tokens_today'],
    ],
    where: {
      user_id: id,
      ...(aiIds.length ? { ai_id: { [Op.in]: aiIds } } : {}),
    },
    include: [
      {
        model: Message,
        as: 'message',
        attributes: [],
        required: false, // LEFT JOIN
        where: { createdAt: { [Op.gte]: startOfToday, [Op.lt]: startOfTomorrow } },
      },
    ],
    group: ['ai_id'],
    raw: true,
  });

  // ---- รวมโทเคน "เดือนนี้" ต่อ ai_id ของผู้ใช้นี้ (ไว้คำนวณ average) ----
  const monthAgg = await Chat.findAll({
    attributes: [
      'ai_id',
      [fn('COALESCE', fn('SUM', col('message.total_token')), 0), 'tokens_month'],
    ],
    where: {
      user_id: id,
      ...(aiIds.length ? { ai_id: { [Op.in]: aiIds } } : {}),
    },
    include: [
      {
        model: Message,
        as: 'message',
        attributes: [],
        required: false, // LEFT JOIN
        where: { createdAt: { [Op.gte]: startOfMonth, [Op.lt]: startOfNextMonth } },
      },
    ],
    group: ['ai_id'],
    raw: true,
  });

  // ---- ทำเป็นแผนที่ดูง่าย ----
  const todayMap = new Map(
    todayAgg.map((r) => [String(r.ai_id), Number(r.tokens_today) || 0])
  );
  const monthMap = new Map(
    monthAgg.map((r) => [String(r.ai_id), Number(r.tokens_month) || 0])
  );

  // ---- ใส่ today และ average ลงในแต่ละ user_ai ----
  const userAiWithStats = (userData.user_ai || []).map((ua) => {
    const key = String(ua.ai_id);
    const tokensToday = todayMap.get(key) ?? 0;
    const tokensMonth = monthMap.get(key) ?? 0;
    const average = Math.round(tokensMonth / daysElapsed); // ปัดเป็นจำนวนเต็ม
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
              attributes: ["model_name", "model_use_name", "model_type"],
              required: false,
            },
          ],
        },
      ],
    });

    if (!user) throw new Error("User not found");

    const { user_role, user_ai, ...userFields } = input;

    console.log(user.user_ai);
    console.log("user_ai", user_ai);

    const changedTokenAiIds = new Set();
    let isStatusChanged = false;
    let isTokenChanged = false;

    // ---------------- ตรวจยอด token ไม่ให้เกิน ----------------
    if (Array.isArray(user_ai)) {
      for (const oldData of user.user_ai) {
        const newData = user_ai.find(
          (ai) => Number(ai.ai_id) === Number(oldData.ai_id)
        );

        if (newData && newData.token_count > oldData.token_count) {
          const aiData = await Ai.findByPk(Number(oldData.ai_id));

          if (newData.token_count - oldData.token_count >= aiData.token_count) {
            throw new Error("จำนวน token ที่เหลืออยู่ไม่เพียงพอ");
          }
        }
      }
    }

    // ---------------- log & notify การเปลี่ยน ai_access ----------------
    if (user.ai_access !== input.ai_access && input.ai_access !== undefined) {
      isStatusChanged = true;

      const message = `กำหนด AI Access ของผู้ใช้งาน (${user.firstname} ${user.lastname})`;

      await auditLog({
        ctx,
        log_type: "PERSONAL",
        old_data: message,
        new_data: message,
        old_status: user.ai_access,
        new_status: input?.ai_access,
      });

      const toThaiApproval = (val) => {
        if (typeof val === "string")
          return ["true", "1", "yes", "y"].includes(val.toLowerCase());
        if (typeof val === "number") return val === 1;
        return !!val;
      };
      const label = (val) => (toThaiApproval(val) ? "อนุมัติ" : "ไม่อนุมัติ");

      await notifyUser({
        userId: id,
        title: "เเจ้งเตือนตั้งค่า Model ของผู้ใช้งาน",
        message: `กำหนด AI Access ของผู้ใช้งาน จาก ${label(
          user.ai_access
        )} เป็น ${label(input?.ai_access)}`,
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

          const old_message = `จำนวน Token ของ Model (${oldData.ai.model_use_name}) ของผู้ใช้งาน (${user.firstname} ${user.lastname}) ${oldData.token_count.toLocaleString()}`;
          const new_message = `จำนวน Token ของ Model (${oldData.ai.model_use_name}) ของผู้ใช้งาน (${user.firstname} ${user.lastname}) ${newData.token_count.toLocaleString()}`;

          await auditLog({
            ctx,
            log_type: "PERSONAL",
            old_data: old_message,
            new_data: new_message,
            old_status: null,
            new_status: null,
          });

          await notifyUser({
            userId: id,
            title: "เเจ้งเตือนตั้งค่า Model ของผู้ใช้งาน",
            message: `จำนวน Token ของ Model (${oldData.ai.model_use_name}) จาก ${oldData.token_count.toLocaleString()} เป็น ${newData.token_count.toLocaleString()}`,
            type: "INFO",
            to: user.email,
          });

          changedTokenAiIds.add(Number(oldData.ai_id));
        }
      }
    }

    // ต้องมีการเปลี่ยน status หรือ token ถึงจะเขียน DB
    const allowWrite = isStatusChanged || isTokenChanged;

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
          include: [{ model: Role, as: "role", attributes: ["role_name"] }],
        },
        {
          model: User_ai,
          as: "user_ai",
          include: [
            {
              model: Ai,
              as: "ai",
              attributes: ["model_name", "model_use_name", "model_type"],
            },
          ],
        },
      ],
      transaction: t,
    });
  });
};

exports.deleteUser = async (id) => {
  const count = await User.destroy({ where: { id } });
  return count > 0;
};
