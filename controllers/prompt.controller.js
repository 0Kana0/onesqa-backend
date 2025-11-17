const { Op } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Prompt } = db;
const { auditLog } = require('../utils/auditLog'); // ปรับ path ให้ตรง

exports.listPrompts = async () => {
  return await Prompt.findAll({
    order: [['id', 'ASC']],
  });
}

exports.getPromptById = async (id) => {
  return await Prompt.findByPk(id);
}

exports.createPrompt = async (input, ctx) => {
  const findTitle = await Prompt.findOne({
    where: { prompt_title: input.prompt_title }
  })
  if (findTitle) throw new Error('prompt_title must not be the same as information in dababase.');

  const message = `เพิ่มข้อมูล: หัวข้อ Prompt: ${input.prompt_title} รายละเอียด Prompt: ${input.prompt_detail}`;

  await auditLog({
    ctx,
    log_type: 'PROMPT',
    old_data: "-",
    new_data: message,
    old_status: null,
    new_status: null,
  });

  // validation อื่น ๆ เช่น ชื่อห้ามซ้ำ:
  return await Prompt.create(input);
}

exports.updatePrompt = async (id, input, ctx) => {
  const row = await Prompt.findByPk(id);
  if (!row) throw new Error('Prompt not found');

  const findTitle = await Prompt.findOne({
    where: {
      prompt_title: input.prompt_title,
      id: {
        [Op.ne]: id, // 🔥 ตัด record ตัวเองออก (ไม่เอา id เดียวกัน)
      },
    },
  });
  if (findTitle) {
    throw new Error("Prompt title already exists");
  }

  console.log(row.prompt_detail);
  console.log(input.prompt_detail);

  // ถ้ามีการเปลี่ยนเเปลงสถานะ ให้ทำการเก็บ log ไว้
  if (row.prompt_title !== input.prompt_title || row.prompt_detail !== input.prompt_detail) {
    const old_message = `ข้อมูลเดิม: หัวข้อ Prompt: ${row.prompt_title} รายละเอียด Prompt: ${row.prompt_detail}`;
    const new_message = `ข้อมูลใหม่: หัวข้อ Prompt: ${input.prompt_title} รายละเอียด Prompt: ${input.prompt_detail}`;

    await auditLog({
      ctx,
      log_type: 'PROMPT',
      old_data: old_message,
      new_data: new_message,
      old_status: null,
      new_status: null,
    });
  }

  await row.update(input);
  return row;
}

exports.deletePrompt = async (id, ctx) => {
  const row = await Prompt.findByPk(id);
  if (!row) throw new Error('Prompt not found');

  const message = `ลบข้อมูล: หัวข้อ Prompt: ${row.prompt_title} รายละเอียด Prompt: ${row.prompt_detail}`;

  await auditLog({
    ctx,
    log_type: 'PROMPT',
    old_data: message,
    new_data: "-",
    old_status: null,
    new_status: null,
  });

  const count = await Prompt.destroy({ where: { id } });
  return count > 0;
}
