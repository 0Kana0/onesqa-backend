'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1) สร้าง ENUM type ถ้ายังไม่มี (Postgres)
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_active_type') THEN
          CREATE TYPE "enum_active_type" AS ENUM ('LOGIN', 'ACTIVE');
        END IF;
      END$$;
    `);

    await queryInterface.createTable('user_daily_active', {
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
      active_type: {
        // อ้าง enum ที่สร้างไว้ด้วยชื่อ type โดยตรง
        type: 'enum_active_type',
        allowNull: false,
        defaultValue: 'LOGIN',
      },
      active_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
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

    // ✅ กันซ้ำ: 1 user / 1 type / 1 วัน
    await queryInterface.addConstraint('user_daily_active', {
      fields: ['user_id', 'active_type', 'active_date'],
      type: 'unique',
      name: 'uq_user_daily_active_user_type_date',
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('user_daily_active');

    // แล้วค่อยลบ ENUM type ทิ้ง เพื่อให้ up ได้ใหม่แบบสะอาด
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_active_type') THEN
          DROP TYPE "enum_active_type";
        END IF;
      END$$;
    `);
  }
};