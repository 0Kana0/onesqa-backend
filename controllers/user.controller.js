// controllers/user.controller.js
const { Op } = require("sequelize");
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { User, User_role, User_ai, Role, Ai } = db;

exports.listUsers = async () => {
  return await User.findAll({
    order: [["id", "ASC"]],
    attributes: { exclude: ["password"] }, // กันเผลอส่ง password ออกไป
    include: [
      {
        model: User_role,
        as: "user_role",
        required: false,
        include: [
          {
            model: Role,
            as: "role", // ต้องตรงกับ alias ใน User_role.belongsTo(...)
            attributes: ["role_name"], // << ดึงชื่อ role ตรงนี้
            required: false,
          },
        ],
      },
      {
        model: User_ai,
        as: "user_ai",
        required: false,
        include: [
          {
            model: Ai,
            as: "ai", // ต้องตรงกับ alias ใน User_role.belongsTo(...)
            attributes: ["model_name"], // << ดึงชื่อ role ตรงนี้
            required: false,
          },
        ],
      },
    ],
  });
};

exports.getByUserId = async (id) => {
  const today = 50000;
  const average = 40000;

  const user = await User.findByPk(id, {
    attributes: { exclude: ["password"] },
    include: [
      {
        model: User_role,
        as: "user_role",
        include: [
          {
            model: Role,
            as: "role", // ต้องตรงกับ alias ใน User_role.belongsTo(...)
            attributes: ["role_name"], // << ดึงชื่อ role ตรงนี้
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
            as: "ai", // ต้องตรงกับ alias ใน User_role.belongsTo(...)
            attributes: ["model_name"], // << ดึงชื่อ role ตรงนี้
            required: false,
          },
        ],
      },
    ],
  });

  if (!user) return null;

  // แปลง Sequelize instance → plain object
  const userData = user.toJSON();

  // ✅ เพิ่ม today, average ลงในแต่ละ user_ai
  const userAiWithStats = (userData.user_ai || []).map((ua) => ({
    ...ua,
    today,
    average,
  }));

  // ✅ แทนค่าใหม่ใน userData
  return {
    ...userData,
    user_ai: userAiWithStats,
  };
};

exports.updateUser = async (id, input) => {
  return await User.sequelize.transaction(async (t) => {
    const user = await User.findByPk(id, {
      transaction: t,
      include: [
        {
          model: User_ai,
          as: "user_ai",
          required: false,
        },
      ],
    });

    if (!user) throw new Error("User not found");

    // 1) อัปเดตฟิลด์ปกติ
    const {
      user_role,
      user_ai, // แยก relation ออก
      ...userFields
    } = input;

    console.log(user.user_ai);
    console.log(user_ai);

    // ส่วนของการดักไม่ให้เพิ่ม token ให้กับ user เกินกว่า token ที่เหลืออยู่
    for (const oldData of user.user_ai) {
      console.log(oldData.ai_id);

      const newData = user_ai.find((ai) => Number(ai.ai_id) === Number(oldData.ai_id));
      console.log(newData);
      // ถ้ามีการเพิ่มจำนวน token
      if (newData.token_count > oldData.token_count) {
        const aiData = await Ai.findByPk(Number(oldData.ai_id));
        console.log(aiData);  

        // ถ้าจำนวน token ที่ต้องการเพิ่มเกินกว่าจำนวน token ที่เหลืออยู่
        if ((newData.token_count - oldData.token_count) >= aiData.token_count) {
          console.log("จำนวน token ที่เหลืออยู่ไม่เพียงพอ");    
          throw new Error('จำนวน token ที่เหลืออยู่ไม่เพียงพอ');    
        } 
      }
    }

    if (Object.keys(userFields).length) {
      await user.update(userFields, { transaction: t });
    }

    // 2) แทนที่ roles ถ้าถูกส่งมา
    if (Array.isArray(user_role)) {
      await User_role.destroy({ where: { user_id: id }, transaction: t });
      const unique = [...new Set(user_role.map((r) => r.role_id))];
      if (unique.length) {
        await User_role.bulkCreate(
          unique.map((role_id) => ({ user_id: id, role_id })),
          { transaction: t }
        );
      }
    }

    // 3) แทนที่ ais ถ้าถูกส่งมา
    if (Array.isArray(user_ai)) {
      await User_ai.destroy({ where: { user_id: id }, transaction: t });
      const byAi = new Map();
      for (const it of user_ai) if (!byAi.has(it.ai_id)) byAi.set(it.ai_id, it);
      const bulk = Array.from(byAi.values()).map((it) => ({
        user_id: id,
        ai_id: it.ai_id,
        token_count: it.token_count ?? null,
        token_all: it.token_all ?? null,
        activity: typeof it.activity === "boolean" ? it.activity : true,
      }));
      if (bulk.length) {
        await User_ai.bulkCreate(bulk, { transaction: t });
      }
    }

    // 4) โหลดกลับพร้อมความสัมพันธ์
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
          include: [{ model: Ai, as: "ai", attributes: ["model_name"] }],
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
