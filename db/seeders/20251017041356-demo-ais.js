'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    const now = new Date();
    const candidates = [
      {
        model_name: 'gpt-5-mini',
        model_use_name: 'ChatGPT 5',
        model_type: 'gpt',
        message_type: "TEXT",
        token_count: 449000000,
        token_all: 449000000,
        activity: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        model_name: 'gemini-2.5-flash',
        model_use_name: 'Gemini 2.5 Pro',
        model_type: 'gemini',
        message_type: "TEXT",
        token_count: 1449000000,
        token_all: 1449000000,
        activity: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        model_name: 'gpt-image-1.5',
        model_use_name: 'ChatGPT Image 1.5',
        model_type: 'gpt',
        message_type: "IMAGE",
        token_count: 1000000,
        token_all: 1000000,
        activity: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        model_name: 'gemini-3-pro-image-preview',
        model_use_name: 'Gemini 3 Pro Image',
        model_type: 'gemini',
        message_type: "IMAGE",
        token_count: 1000000,
        token_all: 1000000,
        activity: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        model_name: 'sora-2-pro',
        model_use_name: 'ChatGPT Sora 2 Pro',
        model_type: 'gpt',
        message_type: "VIDEO",
        token_count: 50000000,
        token_all: 50000000,
        activity: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        model_name: 'veo-3.1-fast-generate-preview',
        model_use_name: 'Gemini Veo 3.1 Fast',
        model_type: 'gemini',
        message_type: "VIDEO",
        token_count: 50000000,
        token_all: 50000000,
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
      model_name: ['gpt-5', 'gemini-2.5-pro']
    }, {});
  }
};
