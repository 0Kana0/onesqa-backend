// controllers/ai.controller.js
const { Op, fn, col } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Ai, Chat, Message } = db;
const { auditLog } = require('../utils/auditLog'); // ปรับ path ให้ตรง
const moment = require('moment-timezone');

/**
 * แยก DB logic สำหรับ Ai ออกมา
 * - สามารถเขียน validation เพิ่มเติม/ธุรกิจลอจิกตรงนี้
 * - ทดสอบแยกหน่วย (unit test) ได้ง่าย
 */
const TZ = 'Asia/Bangkok';

exports.listAis = async () => {
  // ขอบเขตเวลาโซนไทย
  const startOfToday     = moment.tz(TZ).startOf('day').toDate();
  const startOfTomorrow  = moment.tz(TZ).add(1, 'day').startOf('day').toDate();
  const startOfMonth     = moment.tz(TZ).startOf('month').toDate();
  const startOfNextMonth = moment.tz(TZ).add(1, 'month').startOf('month').toDate();
  const daysElapsed      = moment.tz(TZ).diff(moment(startOfMonth), 'days') + 1;

  // 1) รายการ Ai ตามเดิม
  const ais = await Ai.findAll({
    order: [['id', 'ASC']],
    raw: true,
  });

  // 2) รวม token "วันนี้" ต่อ Ai (LEFT JOIN ผ่าน include + required:false)
  const todayAgg = await Ai.findAll({
    attributes: [
      ['id', 'ai_id'],
      [fn('COALESCE', fn('SUM', col('chat->message.total_token')), 0), 'tokens_today'],
    ],
    include: [{
      model: Chat,
      as: 'chat',
      attributes: [],
      required: false,
      include: [{
        model: Message,
        as: 'message',
        attributes: [],
        required: false,
        where: { createdAt: { [Op.gte]: startOfToday, [Op.lt]: startOfTomorrow } },
      }],
    }],
    group: [col('Ai.id')],
    raw: true,
  });

  // 3) รวม token "เดือนนี้" ต่อ Ai (ใช้คำนวณค่าเฉลี่ยต่อวัน)
  const monthAgg = await Ai.findAll({
    attributes: [
      ['id', 'ai_id'],
      [fn('COALESCE', fn('SUM', col('chat->message.total_token')), 0), 'tokens_month'],
    ],
    include: [{
      model: Chat,
      as: 'chat',
      attributes: [],
      required: false,
      include: [{
        model: Message,
        as: 'message',
        attributes: [],
        required: false,
        where: { createdAt: { [Op.gte]: startOfMonth, [Op.lt]: startOfNextMonth } },
      }],
    }],
    group: [col('Ai.id')],
    raw: true,
  });

  // 4) ทำเป็น map เพื่อ join กลับเข้า ais
  const todayMap = new Map(todayAgg.map(r => [String(r.ai_id), Number(r.tokens_today) || 0]));
  const monthMap = new Map(monthAgg.map(r => [String(r.ai_id), Number(r.tokens_month) || 0]));

  // 5) คืนผล พร้อมฟิลด์ today และ average (ปัดเป็นจำนวนเต็ม)
  return ais.map((item) => {
    const tokensToday  = todayMap.get(String(item.id))  ?? 0;
    const tokensMonth  = monthMap.get(String(item.id))  ?? 0;
    const averageDay   = Math.round(tokensMonth / daysElapsed);
    return {
      ...item,
      today: tokensToday,
      average: averageDay,
    };
  });
};

exports.getAiById = async (id) => {
  return await Ai.findByPk(id);
}

exports.createAi = async (input) => {
  if (input.token_count < 0) {
    throw new Error('token_count must be >= 0');
  }
  if (input.token_all < 0) {
    throw new Error('token_all must be >= 0');
  }
  // validation อื่น ๆ เช่น ชื่อห้ามซ้ำ:
  const exists = await Ai.findOne({ where: { model_name: input.model_name } });
  if (exists) throw new Error('model_name already exists');
  return await Ai.create(input);
}

exports.updateAi = async (id, input, ctx) => {
  const row = await Ai.findByPk(id);
  if (!row) throw new Error('Ai not found');

  if (input?.token_count != null && input.token_count < 0) {
    throw new Error('token_count must be >= 0');
  }
  if (input?.token_all != null && input.token_all < 0) {
    throw new Error('token_all must be >= 0');
  }

  if (input.token_count < row.token_count) {
    throw new Error('จำนวน token ไม่สามารถเเก้ไขให้ลดลงได้');
  }

  console.log("row", row);
  console.log("input", input);

  //ถ้ามีการเปลี่ยนเเปลงสถานะ ให้ทำการเก็บ log ไว้
  if (row.activity !== input.activity) {
    const message = `กำหนด AI Access (${row.model_use_name})`

    await auditLog({
      ctx,
      log_type: 'MODEL',
      old_data: message,
      new_data: message,
      old_status: row.activity,
      new_status: input?.activity,
    });
  }

  //ถ้ามีการเปลี่ยนเเปลงจำนวน token ให้ทำการเก็บ log ไว้
  if (row.token_count !== input.token_count) {
    const old_message = `จำนวน Token ของ Model (${row.model_use_name}) ${row.token_count.toLocaleString()}`
    const new_message = `จำนวน Token ของ Model (${row.model_use_name}) ${input.token_count.toLocaleString()}`

    await auditLog({
      ctx,
      log_type: 'MODEL',
      old_data: old_message,
      new_data: new_message,
      old_status: null,
      new_status: null,
    });
  }

  await row.update(input);
  return row;
}

exports.deleteAi = async (id) => {
  const count = await Ai.destroy({ where: { id } });
  return count > 0;
}
