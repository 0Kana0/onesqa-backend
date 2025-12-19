// utils/auditLog.js
const db = require('../db/models'); // <-- ปรับ path ให้ตรงโปรเจกต์ของคุณ
const { Log, User } = db;

function safeToString(v) {
  try {
    if (v === undefined || v === null) return null;
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}

/**
 * บันทึก Log แบบปลอดภัย ไม่พัง flow หลัก
 * @param {Object} params
 * @param {Object} [params.ctx] - ควรมี ctx.req.user.username
 * @param {String} [params.log_type='ALERT'] - 'PROMPT' | 'ALERT' | 'MODEL' | 'PERSONAL' | 'GROUP' | 'ROLE'
 * @param {*} [params.old_data]
 * @param {*} [params.new_data]
 * @param {*} [params.old_status]
 * @param {*} [params.new_status]
 * @param {String} [params.edit_name] - ระบุเอง ถ้าไม่มีก็ดึงจาก ctx
 * @param {Object} [params.transaction] - Sequelize transaction
 */
async function auditLog({
  ctx,
  log_type = 'ALERT',
  old_data = null,
  new_data = null,
  old_status = null,
  new_status = null,
  edit_name,
  transaction,
} = {}) {

  const user = await User.findByPk(ctx?.req?.user?.id, {
    attributes: ["firstname", "lastname"]
  })

  const editor =
    edit_name ||
    user?.firstname + " " + user?.lastname ||
    'system';

  const payload = {
    edit_name: editor,
    log_type,
    old_data: safeToString(old_data),
    new_data: safeToString(new_data),
    old_status,
    new_status,
  };

  try {
    await Log.create(payload, { transaction });
  } catch (err) {
    // ไม่ throw เพื่อไม่ให้กระทบการทำงานหลัก
    console.error('[auditLog] create failed:', err?.message || err);
  }
}

module.exports = { auditLog, safeToString };
