const pubsub = require("../utils/pubsub"); // ✅ ใช้ instance เดียว
const { Op } = require("sequelize");
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { User, RefreshToken } = db;
const moment = require("moment");
const { setUserLoginHistory } = require("../utils/userActive");

// ✅ ดึงเฉพาะผู้ใช้งานที่ออนไลน์อยู่
exports.onlineUsers = async () => {
  const userStatusList = await User.findAll({
    where: { is_online: true },
    order: [["id", "ASC"]],
    raw: true, // ✅ เพิ่มบรรทัดนี้
  });

  // console.log(userStatusList);

  // ✅ ต้อง map array ออกมา ไม่ใช่ object เดียว
  return userStatusList.map((user) => ({
    user_id: user.id,
    username: user.username,
    is_online: user.is_online,
  }));
};

// ✅ ผู้ใช้ Login / ออนไลน์
exports.setUserOnline = async (user_id, ctx) => {
  const userStatus = await User.findOne({ where: { id: user_id } });
  // console.log(userStatus);

  await User.update(
    {
      is_online: true,
    },
    { where: { id: user_id } }
  );

  // ✅ Broadcast event real-time
  pubsub.publish("USER_STATUS_CHANGED", { userStatusChanged: userStatus });
  return {
    user_id: userStatus.id,
    username: userStatus.username,
    is_online: userStatus.is_online,
  };
};

// ❌ ผู้ใช้ออกจากระบบ / ปิด tab
exports.setUserOffline = async (user_id, ctx) => {
  // ตรวจสอบว่ามี refreshToken อยู่ใน DB และยังไม่หมดอายุ
  const existing = await RefreshToken.findAll({
    where: {
      user_id: user_id,
      expiresAt: { [Op.gt]: moment() }, // ยังไม่หมดอายุ
    },
  });
  
  const userStatus = await User.findOne({ where: { id: user_id } });
  if (!userStatus) return null;

  if (existing.length === 0) {
    await User.update(
      {
        is_online: false,
      },
      { where: { id: user_id } }
    );
  }

  setUserLoginHistory(user_id, "LOGOUT", ctx)

  pubsub.publish("USER_STATUS_CHANGED", { userStatusChanged: userStatus });
  return {
    user_id: userStatus.id,
    username: userStatus.username,
    is_online: userStatus.is_online,
  };
};
