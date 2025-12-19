'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('group_ai', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      group_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'group', // ชื่อ table ใน DB
          key: 'id'
        },
        onDelete: 'CASCADE', // ✅ สำคัญ!
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
      init_token: {
        type: Sequelize.INTEGER
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
    await queryInterface.dropTable('group_ai');
  }
};