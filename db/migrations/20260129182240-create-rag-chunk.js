'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('rag_chunk', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      chat_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'chat', // ชื่อ table ใน DB
          key: 'id'
        },
        onDelete: 'CASCADE', // ✅ สำคัญ!
      },
      file_id: { 
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'file', // ชื่อ table ใน DB
          key: 'id'
        },
        onDelete: 'CASCADE', // ✅ สำคัญ!
      },

      file_name: { type: Sequelize.STRING(255), allowNull: false },
      file_ext: { type: Sequelize.STRING(20), allowNull: false },

      chunk_index: { type: Sequelize.INTEGER, allowNull: false },
      content: { type: Sequelize.TEXT("long"), allowNull: false },

      // เก็บ embedding เป็น JSON string (DB-agnostic)
      embedding_json: { type: Sequelize.TEXT("long"), allowNull: false },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    await queryInterface.addIndex("rag_chunk", ["chat_id", "file_id"], { name: "idx_rag_chat_file" });
    await queryInterface.addIndex("rag_chunk", ["file_id"], { name: "idx_rag_file" });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('rag_chunk');
  }
};