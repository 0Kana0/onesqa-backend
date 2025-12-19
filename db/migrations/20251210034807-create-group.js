'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('group', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      group_api_id: {
        allowNull: true,   // ✅ ให้เป็น null ได้
        // primaryKey: true,    // ❌ เอาออก
        // autoIncrement: false // จะมีหรือไม่มีก็ได้ ตามแบบที่ใช้
        type: Sequelize.INTEGER
      },
      name: {
        type: Sequelize.STRING
      },
      code: {
        type: Sequelize.STRING
      },
      data_level: {
        type: Sequelize.STRING
      },
      academy_level_id: {
        type: Sequelize.STRING
      },
      status: { type: Sequelize.BOOLEAN, defaultValue: false },
      ai_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
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
    await queryInterface.dropTable('group');
  }
};