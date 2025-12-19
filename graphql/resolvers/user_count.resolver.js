// graphql/resolvers/user_count.resolver.js
const UserCountController = require('../../controllers/user_count.controller');
const { requireAuth } = require('../../utils/authGuard');

module.exports = {
  Query: {
    cardUserCountReports: async (_parent, args, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await UserCountController.CardUserCountReports();
    },
  },
};
