// graphql/resolvers/user_count.resolver.js
const UserCountController = require('../../controllers/user_count.controller');
const { requireAuth, checkUserInDB } = require('../../utils/authGuard');

module.exports = {
  Query: {
    cardUserCountReports: async (_parent, args, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await UserCountController.CardUserCountReports();
    },
  },
};
