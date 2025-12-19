"use strict";

const bcrypt = require("bcrypt");

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1) สร้าง Admin User
    const passwordHash = await bcrypt.hash("admin1234@", 10);

    // ❌ ห้ามใช้ returning ใน MySQL
    await queryInterface.bulkInsert("user", [
      {
        firstname: "super",
        lastname: "admin",
        username: "Admin01",
        password: passwordHash,
        phone: "",
        email: "",
        login_type: "NORMAL",
        position: "",
        group_name: "",
        ai_access: false,
        color_mode: "LIGHT",
        locale: "th",
        alert: false,
        is_online: false,
        loginAt: null,        // ✅ เพิ่มบรรทัดนี้
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // 2) ดึง id ของ user ที่เพิ่งสร้าง

    // 3) ใส่ role ของแอดมินสูงสุด
    await queryInterface.bulkInsert("user_role", [
      {
        user_id: 1,
        role_id: 4, // 👈 role สูงสุด (แก้ตาม role จริงในระบบ)
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // 4) ใส่สิทธิ์ AI / model quota
    await queryInterface.bulkInsert("user_ai", [
      {
        user_id: 1,
        ai_id: 1,
        token_count: 0,
        token_all: 0,
        is_notification: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        user_id: 1,
        ai_id: 2,
        token_count: 0,
        token_all: 0,
        is_notification: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  },

  async down(queryInterface, Sequelize) {
    // ดึง user id เพื่อให้ undo ถูกต้อง
    const [[user]] = await queryInterface.sequelize.query(
      `SELECT id FROM user WHERE username = 'admin' ORDER BY id DESC LIMIT 1`
    );

    if (user) {
      await queryInterface.bulkDelete("user_role", { user_id: user.id });
      await queryInterface.bulkDelete("user_ai", { user_id: user.id });
      await queryInterface.bulkDelete("user", { id: user.id });
    }
  },
};
