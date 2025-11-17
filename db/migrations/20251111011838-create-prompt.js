'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1) สร้าง ENUM type ถ้ายังไม่มี (Postgres)
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_prompt_locale_type') THEN
          CREATE TYPE "enum_prompt_locale_type" AS ENUM ('th', 'en');
        END IF;
      END$$;
    `);

    await queryInterface.createTable('prompt', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      prompt_title: {
        type: Sequelize.STRING
      },
      prompt_detail: {
        type: Sequelize.TEXT
      },
      locale: {
        // อ้าง enum ที่สร้างไว้ด้วยชื่อ type โดยตรง
        type: 'enum_prompt_locale_type',
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
    await queryInterface.dropTable('prompt');

    // แล้วค่อยลบ ENUM type ทิ้ง เพื่อให้ up ได้ใหม่แบบสะอาด
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_prompt_locale_type') THEN
          DROP TYPE "enum_prompt_locale_type";
        END IF;
      END$$;
    `);
  }
};