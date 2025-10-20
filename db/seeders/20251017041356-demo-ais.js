'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    const now = new Date();
    const candidates = [
      {
        model_name: 'gpt-4o',
        token_count: 1000000000,
        token_all: 1000000000,
        activity: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        model_name: 'gemini-2.5-pro',
        token_count: 1000000000,
        token_all: 1000000000,
        activity: true,
        createdAt: now,
        updatedAt: now,
      },
    ];

    await queryInterface.sequelize.transaction(async (t) => {
      const [existing] = await queryInterface.sequelize.query(
        `SELECT "model_name" FROM "ai" WHERE "model_name" IN (:names);`,
        {
          replacements: { names: candidates.map(c => c.model_name) },
          transaction: t,
        }
      );

      const existingSet = new Set(existing.map(e => e.model_name));
      const toInsert = candidates.filter(c => !existingSet.has(c.model_name));

      if (toInsert.length) {
        await queryInterface.bulkInsert('ai', toInsert, { transaction: t });
      }
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('ai', {
      model_name: ['gpt-4o', 'gemini-2.5-pro']
    }, {});
  }
};
