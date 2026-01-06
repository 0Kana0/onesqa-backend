'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('setting', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      setting_name_th: {
        type: Sequelize.STRING
      },
      setting_name_en: {
        type: Sequelize.STRING
      },
      setting_detail_th: {
        type: Sequelize.STRING
      },
      setting_detail_en: {
        type: Sequelize.STRING
      },
      activity: {
        type: Sequelize.BOOLEAN
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
    await queryInterface.dropTable('setting');
  }
};