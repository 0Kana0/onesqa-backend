'use strict';

module.exports = {
  async up (queryInterface, Sequelize) {
    const now = new Date();
    const candidates = [
      { 
        role_name: 'เจ้าหน้าที่', 
        createdAt: now, 
        updatedAt: now 
      },
      { 
        role_name: 'ผู้ประเมินภายนอก', 
        createdAt: now, 
        updatedAt: now 
      },
      { 
        role_name: 'ผู้ดูแลระบบ', 
        createdAt: now, 
        updatedAt: now 
      },
    ];

    await queryInterface.sequelize.transaction(async (t) => {
      const [existing] = await queryInterface.sequelize.query(
        `SELECT "role_name" FROM "role" WHERE "role_name" IN (:names);`,
        { replacements: { names: candidates.map(c => c.role_name) }, transaction: t }
      );
      const exist = new Set(existing.map(e => e.role_name));
      const toInsert = candidates.filter(c => !exist.has(c.role_name));
      if (toInsert.length) {
        await queryInterface.bulkInsert('role', toInsert, { transaction: t });
      }
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('role', {
      role_name: ['เจ้าหน้าที่', 'ผู้ประเมินภายนอก', 'ผู้ดูแลระบบ']
    }, {});
  }
};
