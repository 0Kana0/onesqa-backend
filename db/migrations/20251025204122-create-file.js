'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('file', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      original_name: {
        type: Sequelize.STRING
      },
      file_name: {
        type: Sequelize.STRING
      },
      extension: {
        type: Sequelize.STRING
      },
      mime_type: {
        type: Sequelize.STRING
      },
      size_bytes: {
        type: Sequelize.INTEGER
      },
      folder: {
        type: Sequelize.STRING
      },
      stored_path: {
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
    await queryInterface.dropTable('file');
  }
};