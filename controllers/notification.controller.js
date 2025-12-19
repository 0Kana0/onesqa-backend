// controllers/notification.controller.js
const { Op } = require("sequelize");
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Notification } = db;
const pubsub = require("../utils/pubsub"); // ✅ ใช้ instance เดียว
const { encodeCursor, decodeCursor } = require('../utils/cursor');

exports.myNotifications = async (user_id, { first = 20, after } = {}) => {
  const safeFirst = Math.max(1, parseInt(first, 10) || 20);
  const limit = safeFirst + 1; // +1 เพื่อเช็ค hasNextPage

  const where = { user_id };

  if (after) {
    const { createdAt, id } = decodeCursor(after);
    // เรียง DESC -> ดึง “ถัดไป” คือรายการที่ createdAt < หรือ (createdAt เท่ากันและ id <)
    where[Op.or] = [
      { createdAt: { [Op.lt]: createdAt } },
      {
        [Op.and]: [{ createdAt }, { id: { [Op.lt]: id } }],
      },
    ];
  }

  const rows = await Notification.findAll({
    where,
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit,
  });

  const hasNextPage = rows.length > safeFirst;
  const slice = hasNextPage ? rows.slice(0, safeFirst) : rows;

  const edges = slice.map((row) => ({
    node: row,
    cursor: encodeCursor(row),
  }));

  const endCursor = edges.length ? edges[edges.length - 1].cursor : null;

  return {
    edges,
    pageInfo: {
      hasNextPage,
      endCursor,
    },
  };
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
