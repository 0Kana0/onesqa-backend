'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();

    // ตัวตั้งต้น (ค่าธุรกิจ)
    const baseCandidates = [
      { role_name_th: 'เจ้าหน้าที่', role_name_en: 'officer' },
      { role_name_th: 'ผู้ประเมินภายนอก', role_name_en: 'external assessor' },
      { role_name_th: 'ผู้ดูแลระบบ', role_name_en: 'administrator' },
      { role_name_th: 'superadmin', role_name_en: 'superadmin' },
    ];

    await queryInterface.sequelize.transaction(async (t) => {
      // 1) ดู schema จริงของตาราง role
      const table = await queryInterface.describeTable('role');

      const hasRoleName = !!table.role_name;
      const hasTH = !!table.role_name_th;
      const hasEN = !!table.role_name_en;

      // timestamps (รองรับทั้ง camelCase และ snake_case)
      const createdKey = table.createdAt ? 'createdAt' : (table.created_at ? 'created_at' : 'createdAt');
      const updatedKey = table.updatedAt ? 'updatedAt' : (table.updated_at ? 'updated_at' : 'updatedAt');

      // 2) เลือก key หลักสำหรับเช็คซ้ำ
      const uniqueKey = hasEN ? 'role_name_en' : (hasRoleName ? 'role_name' : 'role_name_th');

      // 3) สร้างแถวที่จะ insert ให้ตรงกับคอลัมน์ที่มีจริง
      const candidates = baseCandidates.map((c) => {
        const row = {};

        if (hasRoleName) row.role_name = c.role_name_en || c.role_name_th; // fallback
        if (hasTH) row.role_name_th = c.role_name_th;
        if (hasEN) row.role_name_en = c.role_name_en;

        row[createdKey] = now;
        row[updatedKey] = now;

        return row;
      });

      const names = candidates.map((c) => c[uniqueKey]).filter(Boolean);

      // 4) query เช็คของเดิม
      const [existing] = await queryInterface.sequelize.query(
        `SELECT "${uniqueKey}" FROM "role" WHERE "${uniqueKey}" IN (:names);`,
        { replacements: { names }, transaction: t }
      );

      const existSet = new Set(existing.map((e) => e[uniqueKey]));
      const toInsert = candidates.filter((c) => !existSet.has(c[uniqueKey]));

      if (toInsert.length) {
        await queryInterface.bulkInsert('role', toInsert, { transaction: t });
      }
    });
  },

  async down(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('role');

    const hasRoleName = !!table.role_name;
    const hasTH = !!table.role_name_th;
    const hasEN = !!table.role_name_en;

    const uniqueKey = hasEN ? 'role_name_en' : (hasRoleName ? 'role_name' : 'role_name_th');

    // ให้สอดคล้องกับ baseCandidates
    const valuesByKey = {
      role_name_en: ['officer', 'external assessor', 'administrator', 'superadmin'],
      role_name_th: ['เจ้าหน้าที่', 'ผู้ประเมินภายนอก', 'ผู้ดูแลระบบ', 'superadmin'],
      role_name:    ['officer', 'external assessor', 'administrator', 'superadmin'], // fallback ถ้าใช้ role_name เดียว
    };

    const { Op } = Sequelize;

    // ถ้ามีทั้ง th/en ให้ลบแบบ OR เพื่อครอบคลุม
    if (hasTH && hasEN) {
      await queryInterface.bulkDelete(
        'role',
        {
          [Op.or]: [
            { role_name_en: { [Op.in]: valuesByKey.role_name_en } },
            { role_name_th: { [Op.in]: valuesByKey.role_name_th } },
          ],
        },
        {}
      );
      return;
    }

    // ไม่งั้นลบตาม uniqueKey ที่เลือก
    await queryInterface.bulkDelete(
      'role',
      { [uniqueKey]: { [Op.in]: valuesByKey[uniqueKey] } },
      {}
    );
  },
};
