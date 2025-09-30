'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1) สร้าง ENUM type ถ้ายังไม่มี (Postgres)
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_users_login_type') THEN
          CREATE TYPE "enum_users_login_type" AS ENUM ('NORMAL', 'INSPEC');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_users_color_mode') THEN
          CREATE TYPE "enum_users_color_mode" AS ENUM ('LIGHT', 'DARK');
        END IF;
      END$$;
    `);

    // 2) สร้างตาราง (เปลี่ยนชื่อเป็น users)
    await queryInterface.createTable('user', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      firstname: { type: Sequelize.STRING },
      lastname: { type: Sequelize.STRING },
      username: { type: Sequelize.STRING },
      password: { type: Sequelize.STRING },
      phone: { type: Sequelize.STRING },
      email: { type: Sequelize.STRING },
      login_type: {
        // อ้าง enum ที่สร้างไว้ด้วยชื่อ type โดยตรง
        type: 'enum_users_login_type',
        allowNull: false,
        defaultValue: 'NORMAL',
      },
      position: { type: Sequelize.STRING },
      group_name: { type: Sequelize.STRING },
      ai_access: { type: Sequelize.BOOLEAN, defaultValue: false },
      color_mode: {
        type: 'enum_users_color_mode',
        allowNull: false,
        defaultValue: 'LIGHT',
      },
      loginAt: { type: Sequelize.DATE },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    // (อาจเพิ่ม unique index ให้ username/email ถ้าต้องการ)
    // await queryInterface.addIndex('users', ['username'], { unique: true });
    // await queryInterface.addIndex('users', ['email'], { unique: true });
  },

  async down(queryInterface, Sequelize) {
    // ลบตารางก่อน
    await queryInterface.dropTable('user');

    // แล้วค่อยลบ ENUM type ทิ้ง เพื่อให้ up ได้ใหม่แบบสะอาด
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_users_login_type') THEN
          DROP TYPE "enum_users_login_type";
        END IF;
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_users_color_mode') THEN
          DROP TYPE "enum_users_color_mode";
        END IF;
      END$$;
    `);
  },
};
