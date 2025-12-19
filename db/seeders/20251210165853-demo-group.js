"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();

    // 1) สร้าง group "กลุ่มผู้ประเมินภายนอก"
    await queryInterface.bulkInsert("group", [
      {
        group_api_id: null,                // internal group ไม่ได้มาจาก API
        name: "กลุ่มผู้ประเมินภายนอก",   // ชื่อกลุ่ม
        code: "กลุ่มผู้ประเมินภายนอก",   // ใช้ code เป็น unique key
        data_level: null,
        academy_level_id: null,
        status: false,
        ai_id: null,                       // ยังไม่ผูก AI ใด ๆ โดยตรง
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 2) หา id ของ group ที่เพิ่งสร้างขึ้นมา
    const [groups] = await queryInterface.sequelize.query(
      `SELECT id FROM "group" WHERE code = 'กลุ่มผู้ประเมินภายนอก'`
    );

    if (!groups.length) {
      console.warn('⚠️ ไม่พบ group code = "กลุ่มผู้ประเมินภายนอก" หลัง bulkInsert');
      return;
    }

    const groupId = groups[0].id;

    // 3) ดึง Ai ทั้งหมดจาก table ai
    const [ais] = await queryInterface.sequelize.query(
      `SELECT id FROM "ai"`
    );

    if (!ais.length) {
      console.warn("⚠️ ไม่พบข้อมูลในตาราง ai — จะไม่สร้าง group_ai ใด ๆ");
      return;
    }

    // 4) สร้าง mapping ลง table group_ai (group นี้ × Ai ทุกตัว)
    const groupAiRows = ais.map((ai) => ({
      group_id: groupId,
      ai_id: ai.id,
      init_token: 0,
      createdAt: now,
      updatedAt: now,
    }));

    await queryInterface.bulkInsert("group_ai", groupAiRows);
  },

  async down(queryInterface, Sequelize) {
    const now = new Date();

    // หา id ของ group "กลุ่มผู้ประเมินภายนอก"
    const [groups] = await queryInterface.sequelize.query(
      `SELECT id FROM "group" WHERE code = 'กลุ่มผู้ประเมินภายนอก'`
    );

    if (!groups.length) {
      console.warn('⚠️ (down) ไม่พบ group code = "กลุ่มผู้ประเมินภายนอก"');
      return;
    }

    const groupId = groups[0].id;

    // 1) ลบ mapping ทั้งหมดใน group_ai ของ group นี้ก่อน (กัน FK)
    await queryInterface.bulkDelete(
      "group_ai",
      { group_id: groupId },
      {}
    );

    // 2) แล้วค่อยลบ group เอง
    await queryInterface.bulkDelete(
      "group",
      { id: groupId },
      {}
    );
  },
};
