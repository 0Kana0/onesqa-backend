'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_token', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      used_date: {
        allowNull: false,
        type: Sequelize.DATEONLY
      },
      input_token: {
        type: Sequelize.INTEGER
      },
      output_token: {
        type: Sequelize.INTEGER
      },
      total_token: {
        type: Sequelize.INTEGER
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,               // ❗ ต้อง allowNull เพราะจะถูก set null
        references: {
          model: 'user',
          key: 'id'
        },
        onDelete: 'SET NULL',          // ✅ เวลา user ถูกลบ → ตัวนี้เป็น null
        onUpdate: 'CASCADE'
      },
      ai_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'ai', // ชื่อ table ใน DB
          key: 'id'
        },
        onDelete: 'CASCADE', // ✅ สำคัญ!
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
    await queryInterface.dropTable('user_token');
  }
};