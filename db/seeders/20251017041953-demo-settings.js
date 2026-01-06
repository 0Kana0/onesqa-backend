'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();

    const baseCandidates = [
      {
        setting_name_th: "การแจ้งเตือนระบบ",
        setting_name_en: "System Notifications",
        setting_detail_th: "รับการแจ้งเตือนเกี่ยวกับสถานะระบบและการใช้งาน",
        setting_detail_en: "Receive notifications about system status and usage",
        activity: true,
      },
      {
        setting_name_th: "การแจ้งเตือนทางอีเมล",
        setting_name_en: "Email Notifications",
        setting_detail_th: "ส่งการแจ้งเตือนไปยังอีเมลของคุณ",
        setting_detail_en: "Send notifications to your email",
        activity: true,
      },
    ];

    await queryInterface.sequelize.transaction(async (t) => {
      // 1) ดู schema จริงของตาราง setting
      const table = await queryInterface.describeTable('setting');

      const hasName = !!table.setting_name;
      const hasTH = !!table.setting_name_th;
      const hasEN = !!table.setting_name_en;

      const hasDetailTH = !!table.setting_detail_th;
      const hasDetailEN = !!table.setting_detail_en;
      const hasDetail = !!table.setting_detail;

      const hasActivity = !!table.activity;

      // timestamps (รองรับ camelCase / snake_case)
      const createdKey = table.createdAt ? 'createdAt' : (table.created_at ? 'created_at' : 'createdAt');
      const updatedKey = table.updatedAt ? 'updatedAt' : (table.updated_at ? 'updated_at' : 'updatedAt');

      // 2) เลือก key สำหรับเช็คซ้ำ (prefer EN > setting_name > TH)
      const uniqueKey = hasEN ? 'setting_name_en' : (hasName ? 'setting_name' : 'setting_name_th');

      // 3) map candidates ให้ตรงกับคอลัมน์จริง
      const candidates = baseCandidates.map((c) => {
        const row = {};

        if (hasName) row.setting_name = c.setting_name_en || c.setting_name_th; // fallback
        if (hasTH) row.setting_name_th = c.setting_name_th;
        if (hasEN) row.setting_name_en = c.setting_name_en;

        // detail: รองรับทั้งแบบแยก th/en หรือรวมเป็น setting_detail เดียว
        if (hasDetailTH) row.setting_detail_th = c.setting_detail_th;
        if (hasDetailEN) row.setting_detail_en = c.setting_detail_en;
        if (hasDetail) row.setting_detail = c.setting_detail_en || c.setting_detail_th;

        if (hasActivity) row.activity = c.activity;

        row[createdKey] = now;
        row[updatedKey] = now;

        return row;
      });

      const names = candidates.map((c) => c[uniqueKey]).filter(Boolean);

      // 4) เช็คของเดิม
      const [existing] = await queryInterface.sequelize.query(
        `SELECT "${uniqueKey}" FROM "setting" WHERE "${uniqueKey}" IN (:names);`,
        { replacements: { names }, transaction: t }
      );

      const existSet = new Set(existing.map((e) => e[uniqueKey]));
      const toInsert = candidates.filter((c) => !existSet.has(c[uniqueKey]));

      if (toInsert.length) {
        await queryInterface.bulkInsert('setting', toInsert, { transaction: t });
      }
    });
  },

  async down(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('setting');

    const hasName = !!table.setting_name;
    const hasTH = !!table.setting_name_th;
    const hasEN = !!table.setting_name_en;

    const uniqueKey = hasEN ? 'setting_name_en' : (hasName ? 'setting_name' : 'setting_name_th');

    const valuesByKey = {
      setting_name_en: ["System Notifications", "Email Notifications"],
      setting_name_th: ["การแจ้งเตือนระบบ", "การแจ้งเตือนทางอีเมล"],
      setting_name: ["System Notifications", "Email Notifications"], // fallback ถ้าใช้ setting_name เดียว
    };

    const { Op } = Sequelize;

    // ถ้ามีทั้ง th/en ลบแบบ OR เพื่อครอบคลุม
    if (hasTH && hasEN) {
      await queryInterface.bulkDelete(
        'setting',
        {
          [Op.or]: [
            { setting_name_en: { [Op.in]: valuesByKey.setting_name_en } },
            { setting_name_th: { [Op.in]: valuesByKey.setting_name_th } },
          ],
        },
        {}
      );
      return;
    }

    await queryInterface.bulkDelete(
      'setting',
      { [uniqueKey]: { [Op.in]: valuesByKey[uniqueKey] } },
      {}
    );
  },
};
