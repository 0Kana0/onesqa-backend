'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // ✅ เพิ่มข้อมูลตัวอย่าง
    await queryInterface.bulkInsert('role', [
      {
        role_name: 'เจ้าหน้าที่',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        role_name: 'ผู้ประเมินภายนอก',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        role_name: 'ผู้ดูแลระบบ',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ], {});
  },

  async down (queryInterface, Sequelize) {
    // ✅ ลบข้อมูลที่ seed ไว้
    await queryInterface.bulkDelete('role', null, {});
  }
};
