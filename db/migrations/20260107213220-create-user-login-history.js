'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1) สร้าง ENUM type ถ้ายังไม่มี (Postgres)
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_event_type') THEN
          CREATE TYPE "enum_event_type" AS ENUM ('LOGIN_SUCCESS', 'LOGOUT');
        END IF;
      END$$;
    `);
    
    await queryInterface.createTable('user_login_history', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'user', // ชื่อ table ใน DB
          key: 'id'
        },
        onDelete: 'CASCADE', // ✅ สำคัญ!
      },
      event_type: {
        // อ้าง enum ที่สร้างไว้ด้วยชื่อ type โดยตรง
        type: 'enum_event_type',
        allowNull: false,
        defaultValue: 'LOGIN_SUCCESS',
      },
      user_agent: {
        type: Sequelize.STRING
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('user_login_history');

    // แล้วค่อยลบ ENUM type ทิ้ง เพื่อให้ up ได้ใหม่แบบสะอาด
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_event_type') THEN
          DROP TYPE "enum_event_type";
        END IF;
      END$$;
    `);
  }
};