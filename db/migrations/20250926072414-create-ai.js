'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1) สร้าง ENUM type ถ้ายังไม่มี (Postgres)
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_ai_type') THEN
          CREATE TYPE "enum_ai_type" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'DOC');
        END IF;
      END$$;
    `);

    await queryInterface.createTable('ai', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      model_name: {
        type: Sequelize.STRING
      },
      model_use_name: {
        type: Sequelize.STRING
      },
      model_type: {
        type: Sequelize.STRING
      },
      message_type: {
        // อ้าง enum ที่สร้างไว้ด้วยชื่อ type โดยตรง
        type: 'enum_ai_type',
        allowNull: false,
      },
      token_count: {
        type: Sequelize.INTEGER
      },
      token_all: {
        type: Sequelize.INTEGER
      },
      activity: {
        type: Sequelize.BOOLEAN
      },
      is_notification: {
        type: Sequelize.BOOLEAN, defaultValue: false
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
    await queryInterface.dropTable('ai');
  }
};