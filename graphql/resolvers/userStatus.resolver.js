const pubsub = require("../../utils/pubsub"); // ✅ ใช้ instance เดียว
const userStatusController = require("../../controllers/userStatus.controller");
const { requireAuth, checkUserInDB } = require("../../utils/authGuard");

module.exports = {
  Query: {
    // ✅ ดึงเฉพาะผู้ใช้งานที่ออนไลน์อยู่
    onlineUsers: async (_parent) => {
      //requireAuth(ctx);
      //await checkUserInDB(ctx);
      return await userStatusController.onlineUsers();
    },
  },

  Mutation: {
    // ✅ ผู้ใช้ Login / ออนไลน์
    setUserOnline: async (_, { user_id }, ctx) => {
      //requireAuth(ctx);
      await checkUserInDB(ctx);
      return await userStatusController.setUserOnline(user_id, ctx);
    },

    // ❌ ผู้ใช้ออกจากระบบ / ปิด tab
    setUserOffline: async (_, { user_id }, ctx) => {
      //requireAuth(ctx);
      await checkUserInDB(ctx);
      return await userStatusController.setUserOffline(user_id, ctx);
    },
  },

  Subscription: {
    // ✅ Broadcast ทุกครั้งที่มีการเปลี่ยนสถานะ
    userStatusChanged: {
      subscribe: () => pubsub.asyncIterableIterator(["USER_STATUS_CHANGED"]),
    },
  },
};
