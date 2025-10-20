// controllers/notification.controller.js
const { Op } = require("sequelize");
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Notification } = db;
const pubsub = require("../utils/pubsub"); // ✅ ใช้ instance เดียว

exports.myNotifications = async (user_id) => {
  return await Notification.findAll({
    where: { user_id },
    order: [["createdAt", "DESC"]],
  });
};

exports.createNotification = async (input) => {
  const { user_id, title, message, type } = input;

  const noti = await Notification.create({
    user_id,
    title,
    message,
    type,
  });

  // ✅ ส่ง event ผ่าน pubsub สำหรับ real-time
  pubsub.publish("NOTIFICATION_ADDED", { notificationAdded: noti });
  return noti;
};
