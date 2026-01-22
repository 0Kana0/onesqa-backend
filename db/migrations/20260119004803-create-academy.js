'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('academy', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      academy_api_id: {
        allowNull: false,           // ✅ แนะนำ: ต้องมีค่าเพื่อ upsert ได้ชัวร์
        type: Sequelize.INTEGER,
      },
      name: { type: Sequelize.STRING },
      code: {
        type: Sequelize.STRING,
        allowNull: false,           // ✅ แนะนำ: code ใช้ค้นหาบ่อย
      },
      academy_level_id: {
        type: Sequelize.STRING,
        allowNull: false,           // ✅ แนะนำ: เป็น key ชุด unique
      },
      sar_file: {
        type: Sequelize.JSONB,      // ✅ Postgres ใช้ JSONB ดีกว่า
        allowNull: false,
        defaultValue: [],           // ✅ default เป็น array ว่าง
      },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });

    // ✅ ทำให้ ON CONFLICT (academy_level_id, academy_api_id) ใช้ได้
    await queryInterface.addConstraint('academy', {
      fields: ['academy_level_id', 'academy_api_id'],
      type: 'unique',
      name: 'academy_level_api_unique',
    });

    // (เสริม) index สำหรับค้นหาตาม code เร็วขึ้น
    await queryInterface.addIndex('academy', ['code'], {
      name: 'academy_code_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('academy');
  },
};
