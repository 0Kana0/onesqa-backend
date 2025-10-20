'use strict';

module.exports = {
  async up (queryInterface, Sequelize) {
    const now = new Date();
    const candidates = [
      {
        setting_name: 'การแจ้งเตือนระบบ',
        setting_detail: 'รับการแจ้งเตือนเกี่ยวกับสถานะระบบและการใช้งาน',
        activity: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        setting_name: 'การแจ้งเตือนทางอีเมล',
        setting_detail: 'ส่งการแจ้งเตือนไปยังอีเมลของคุณ',
        activity: true,
        createdAt: now,
        updatedAt: now,
      },
    ];

    await queryInterface.sequelize.transaction(async (t) => {
      const [existing] = await queryInterface.sequelize.query(
        `SELECT "setting_name" FROM "setting" WHERE "setting_name" IN (:names);`,
        { replacements: { names: candidates.map(c => c.setting_name) }, transaction: t }
      );

      const exist = new Set(existing.map(e => e.setting_name));
      const toInsert = candidates.filter(c => !exist.has(c.setting_name));

      if (toInsert.length) {
        await queryInterface.bulkInsert('setting', toInsert, { transaction: t });
      }
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('setting', {
      setting_name: ['การแจ้งเตือนระบบ', 'การแจ้งเตือนทางอีเมล']
    }, {});
  }
};
