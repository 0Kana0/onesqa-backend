"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const t = await queryInterface.sequelize.transaction();

    try {
      const code = "กลุ่มผู้ประเมินภายนอก";

      // ✅ 0) ถ้ามี group อยู่แล้ว ใช้ id เดิม (ไม่สร้างซ้ำ)
      let groups = await queryInterface.sequelize.query(
        `SELECT id FROM "group" WHERE code = :code LIMIT 1`,
        {
          replacements: { code },
          type: queryInterface.sequelize.QueryTypes.SELECT,
          transaction: t,
        }
      );

      if (!groups.length) {
        // 1) สร้าง group "กลุ่มผู้ประเมินภายนอก"
        await queryInterface.bulkInsert(
          "group",
          [
            {
              group_api_id: null,
              name: code,
              code: code, // unique key
              data_level: null,
              academy_level_id: null,
              status: false,
              ai_id: null,
              createdAt: now,
              updatedAt: now,
            },
          ],
          { transaction: t }
        );

        // 2) หา id ของ group ที่เพิ่งสร้าง
        groups = await queryInterface.sequelize.query(
          `SELECT id FROM "group" WHERE code = :code LIMIT 1`,
          {
            replacements: { code },
            type: queryInterface.sequelize.QueryTypes.SELECT,
            transaction: t,
          }
        );
      }

      if (!groups.length) {
        console.warn(`⚠️ ไม่พบ group code = "${code}" หลัง bulkInsert`);
        await t.commit();
        return;
      }

      const groupId = groups[0].id;

      // 3) ดึง Ai ทั้งหมดจาก table ai
      const ais = await queryInterface.sequelize.query(`SELECT id FROM "ai"`, {
        type: queryInterface.sequelize.QueryTypes.SELECT,
        transaction: t,
      });

      if (!ais.length) {
        console.warn('⚠️ ไม่พบข้อมูลในตาราง ai — จะไม่สร้าง group_ai ใด ๆ');
        await t.commit();
        return;
      }

      // ✅ 4) กัน insert ซ้ำ: เช็ค mapping ที่มีอยู่แล้วก่อน
      const existingMappings = await queryInterface.sequelize.query(
        `SELECT ai_id FROM "group_ai" WHERE group_id = :groupId`,
        {
          replacements: { groupId },
          type: queryInterface.sequelize.QueryTypes.SELECT,
          transaction: t,
        }
      );

      const existingAiSet = new Set(existingMappings.map((r) => r.ai_id));

      const groupAiRows = ais
        .filter((ai) => !existingAiSet.has(ai.id))
        .map((ai) => ({
          group_id: groupId,
          ai_id: ai.id,
          init_token: 0,
          createdAt: now,
          updatedAt: now,
        }));

      if (groupAiRows.length > 0) {
        await queryInterface.bulkInsert("group_ai", groupAiRows, { transaction: t });
      }

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  async down(queryInterface, Sequelize) {
    const t = await queryInterface.sequelize.transaction();
    try {
      const code = "กลุ่มผู้ประเมินภายนอก";

      const groups = await queryInterface.sequelize.query(
        `SELECT id FROM "group" WHERE code = :code LIMIT 1`,
        {
          replacements: { code },
          type: queryInterface.sequelize.QueryTypes.SELECT,
          transaction: t,
        }
      );

      if (!groups.length) {
        console.warn(`⚠️ (down) ไม่พบ group code = "${code}"`);
        await t.commit();
        return;
      }

      const groupId = groups[0].id;

      // 1) ลบ mapping ใน group_ai ก่อน (กัน FK)
      await queryInterface.bulkDelete("group_ai", { group_id: groupId }, { transaction: t });

      // 2) ลบ group
      await queryInterface.bulkDelete("group", { id: groupId }, { transaction: t });

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },
};
