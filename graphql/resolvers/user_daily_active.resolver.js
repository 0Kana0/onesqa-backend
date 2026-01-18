// graphql/resolvers/user_daily_active.resolver.js
const UserDailyActiveController = require('../../controllers/user_daily_active.controller');
const { requireAuth, checkUserInDB } = require('../../utils/authGuard');

module.exports = {
  Query: {
    periodUsersActive: async (_parent, { period }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await UserDailyActiveController.periodUsersActive({ period });
    },
  },
};
