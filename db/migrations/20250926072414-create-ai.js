'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
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