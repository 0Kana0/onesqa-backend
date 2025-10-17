'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // ✅ เพิ่มข้อมูลตัวอย่าง
    await queryInterface.bulkInsert('ai', [
      {
        model_name: 'gpt-4o',
        token_count: 1000000000,
        token_all: 1000000000,
        activity: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        model_name: 'gemini-2.5-pro',
        token_count: 1000000000,
        token_all: 1000000000,
        activity: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ], {});
  },

  async down (queryInterface, Sequelize) {
    // ✅ ลบข้อมูลที่ seed ไว้
    await queryInterface.bulkDelete('ai', null, {});
  }
};
