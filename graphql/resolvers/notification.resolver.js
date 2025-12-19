const { withFilter } = require("graphql-subscriptions");
const pubsub = require("../../utils/pubsub"); // ✅ ใช้ instance เดียว
const NotificationController = require("../../controllers/notification.controller");
const { requireAuth } = require("../../utils/authGuard");

module.exports = {
  Query: {
    myNotifications: async (_parent, { user_id, first = 20, after }, ctx) => {
      requireAuth(ctx);
      return NotificationController.myNotifications(user_id, { first, after });
    },
  },

  Mutation: {
    createNotification: async (_parent, { input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await NotificationController.createNotification(input);
    },
  },

  Subscription: {
    notificationAdded: {
      subscribe: withFilter(
        () => pubsub.asyncIterableIterator(["NOTIFICATION_ADDED"]),
        (payload, variables) => {
          if (!payload || !payload.notificationAdded) return false;
          return (
            String(payload.notificationAdded.user_id) ===
            String(variables.user_id)
          );
        }
      ),

      // 3️⃣ resolve: แปลงหรือ return ข้อมูลให้ client
      resolve: (payload) => payload.notificationAdded,
    },
  },
};
