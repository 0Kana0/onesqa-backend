// utils/notifier.js
// ใช้ได้กับ Node + Sequelize + GraphQL PubSub + Nodemailer
// ปรับ path models ให้ตรงโปรเจ็กต์ของคุณ
const db = require("../db/models"); // <-- ปรับ path ให้ตรงโปรเจกต์ของคุณ
const { Notification, Setting, User } = db;
const pubsub = require("../utils/pubsub"); // ✅ ใช้ instance เดียว
const { enqueueEmail } = require("../services/email.service.js");

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
    locale,
    recipient_locale,
    loginAt,
    userId,
    title,
    message,
    type = "INFO",

    // Email
    to,
    subject,

    transaction,
  } = opts;

  // if (!userId) {
  //   throw new Error(
  //     locale === "th"
  //       ? 'notifyUser: จำเป็นต้องระบุ "userId"'
  //       : 'notifyUser: "userId" is required'
  //   );
  // }
  // if (!title) {
  //   throw new Error(
  //     locale === "th"
  //       ? 'notifyUser: จำเป็นต้องระบุ "title"'
  //       : 'notifyUser: "title" is required'
  //   );
  // }
  // if (!message) {
  //   throw new Error(
  //     locale === "th"
  //       ? 'notifyUser: จำเป็นต้องระบุ "message"'
  //       : 'notifyUser: "message" is required'
  //   );
  // }

  const setting = await Setting.findAll()

  const notiSetting = setting.find((setting) => (setting.setting_name_th) === ("การแจ้งเตือนระบบ"));
  const emailSetting = setting.find((setting) => (setting.setting_name_th) === ("การแจ้งเตือนทางอีเมล"));

  //console.log("notiSetting", notiSetting);
  //console.log("emailSetting", emailSetting);

  // เเจ้งเตือนเฉพาะผู้ใช้งานที่เคยเข้าใช้งานระบบ
  if (loginAt !== null) {
    // 1) บันทึก DB
    const noti = await Notification.create({
      locale,
      user_id: userId,
      title,
      message,
      type,
    });

    if (
      notiSetting.activity === true && 
      locale === recipient_locale
    ) {
      const editUser = await User.update({
        alert: true,
      }, { where: { id: userId } })
      // 2) ยิง PubSub (non-blocking)
      // ✅ ส่ง event ผ่าน pubsub สำหรับ real-time
      pubsub.publish("NOTIFICATION_ADDED", { notificationAdded: noti });
    }

    if (
      emailSetting.activity === true && 
      to && 
      locale === recipient_locale
    ) {
      // 3) ส่งอีเมล (optional, non-blocking)
      try {
        await enqueueEmail({
          to,
          subject: subject || title,
          text: message,
          // ถ้าจะส่งแบบ html ก็ใส่เพิ่มได้:
          // html: `<p>${message}</p>`,
          meta: { userId, locale, type }, // optional ไว้ debug/log
        });
      } catch (err) {
        console.log("enqueueEmail error:", err);
      }
    }
  }
}

module.exports = { notifyUser };
