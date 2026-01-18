'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1) สร้าง ENUM type ถ้ายังไม่มี (Postgres)
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_log_type') THEN
          CREATE TYPE "enum_log_type" AS ENUM ('PROMPT', 'ALERT', 'MODEL', 'PERSONAL', 'GROUP', 'ROLE');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_log_locale_type') THEN
          CREATE TYPE "enum_log_locale_type" AS ENUM ('th', 'en');
        END IF;
      END$$;
    `);

    await queryInterface.createTable('log', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      edit_name: {
        type: Sequelize.STRING
      },
      log_type: {
        type: Sequelize.ENUM('PROMPT', 'ALERT', 'MODEL', 'PERSONAL', 'GROUP', 'ROLE'),
        allowNull: false
      },
      old_data: {
        type: Sequelize.TEXT
      },
      new_data: {
        type: Sequelize.TEXT
      },
      old_status: {
        type: Sequelize.BOOLEAN
      },
      new_status: {
        type: Sequelize.BOOLEAN
      },
      locale: {
        // อ้าง enum ที่สร้างไว้ด้วยชื่อ type โดยตรง
        type: 'enum_log_locale_type',
        allowNull: false,
        defaultValue: 'th',
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
    await queryInterface.dropTable('log');

    // แล้วค่อยลบ ENUM type ทิ้ง เพื่อให้ up ได้ใหม่แบบสะอาด
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_log_type') THEN
          DROP TYPE "enum_log_type";
        END IF;
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_log_locale_type') THEN
          DROP TYPE "enum_log_locale_type";
        END IF;
      END$$;
    `);
  }
};