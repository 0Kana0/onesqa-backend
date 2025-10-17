'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // ✅ เพิ่มข้อมูลตัวอย่าง
    await queryInterface.bulkInsert('setting', [
      {
        setting_name: 'การแจ้งเตือนระบบ',
        setting_detail: 'รับการแจ้งเตือนเกี่ยวกับสถานะระบบและการใช้งาน',
        activity: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        setting_name: 'การแจ้งเตือนทางอีเมล',
        setting_detail: 'ส่งการแจ้งเตือนไปยังอีเมลของคุณ',
        activity: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ], {});
  },

  async down (queryInterface, Sequelize) {
    // ✅ ลบข้อมูลที่ seed ไว้
    await queryInterface.bulkDelete('setting', null, {});
  }
};
