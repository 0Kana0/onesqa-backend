// utils/notifier.js
// ใช้ได้กับ Node + Sequelize + GraphQL PubSub + Nodemailer
// ปรับ path models ให้ตรงโปรเจ็กต์ของคุณ
const db = require("../db/models"); // <-- ปรับ path ให้ตรงโปรเจกต์ของคุณ
const { Notification, Setting } = db;
const pubsub = require("../utils/pubsub"); // ✅ ใช้ instance เดียว
const transporter = require("../config/email-config.js");

/**
 * ส่ง Notification (DB) + ยิง PubSub + ส่งอีเมล (เลือกได้)
 * - ถ้า Notification.create พัง => throw (ถือเป็น core path)
 * - ถ้า PubSub/Email พัง => log error แต่ไม่ throw (ค่าเริ่มต้น)
 *
 * @param {Object} opts
 * @param {string|number} opts.userId            - ผู้รับแจ้งเตือน (required)
 * @param {string}         opts.title            - หัวข้อแจ้งเตือน (required)
 * @param {string}         opts.message          - เนื้อหาข้อความ (required)
 * @param {('INFO'|'WARN'|'ERROR'|'SUCCESS')} [opts.type='INFO'] - ประเภทแจ้งเตือน
 * @param {Object}        [opts.transaction]     - Sequelize transaction
 *
 * PubSub:
 * @param {Object}        [opts.pubsub]          - instance ของ PubSub
 * @param {string}        [opts.eventName='NOTIFICATION_ADDED']
 * @param {string}        [opts.payloadKey='notificationAdded']
 *
 * Email:
 * @param {Object}        [opts.transporter]     - Nodemailer transporter
 * @param {string|string[]} [opts.to]            - อีเมลผู้รับ
 * @param {string}        [opts.subject]         - หัวข้ออีเมล (default = title)
 * @param {string}        [opts.from]            - ผู้ส่ง (default = `<${process.env.EMAIL_USER}>`)
 * @param {boolean}       [opts.sendEmail=true]  - ส่งอีเมลหรือไม่
 * @param {boolean}       [opts.silentEmailError=true] - ถ้า email ล้มเหลวจะไม่ throw
 *
 * @returns {Promise<{ notification: any, published: boolean, emailInfo: any }>}
 */
async function notifyUser(opts = {}) {
  const {
    userId,
    title,
    message,
    type = "INFO",

    // Email
    to,
    subject,

    transaction,
  } = opts;

  if (!userId) throw new Error('notifyUser: "userId" is required');
  if (!title) throw new Error('notifyUser: "title" is required');
  if (!message) throw new Error('notifyUser: "message" is required');

  const setting = await Setting.findAll()

  const notiSetting = setting.find((setting) => (setting.setting_name) === ("การแจ้งเตือนระบบ"));
  const emailSetting = setting.find((setting) => (setting.setting_name) === ("การแจ้งเตือนทางอีเมล"));

  //console.log("notiSetting", notiSetting);
  //console.log("emailSetting", emailSetting);

  // 1) บันทึก DB
  const noti = await Notification.create({
    user_id: userId,
    title,
    message,
    type,
  });

  if (notiSetting.activity === true) {
    // 2) ยิง PubSub (non-blocking)
    // ✅ ส่ง event ผ่าน pubsub สำหรับ real-time
    pubsub.publish("NOTIFICATION_ADDED", { notificationAdded: noti });
  }

  if (emailSetting.activity === true) {
    // 3) ส่งอีเมล (optional, non-blocking)
    try {
      await transporter.sendMail({
        from: `<${process.env.EMAIL_USER}>`,
        to,
        subject: title,
        text: message,
      });
    } catch (e) {
      if (!silentEmailError) throw e;
      console.error("[notifyUser] email send failed:", e?.message || e);
    }
  }
}

module.exports = { notifyUser };
