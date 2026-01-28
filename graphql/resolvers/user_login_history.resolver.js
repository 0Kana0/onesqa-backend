// graphql/resolvers/user_login_history.resolver.js
const UserLoginHistoryController = require('../../controllers/user_login_history.controller');
const { requireAuth, checkUserInDB } = require('../../utils/authGuard');

module.exports = {
  Query: {
    loginHistory: async (_p, { page, pageSize, where }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await UserLoginHistoryController.listUsersLoginHistory({ page, pageSize, where });
    },
  },
  Mutation: {
    deleteLoginHistorys: async (_paren, args, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await UserLoginHistoryController.deleteLoginHistorys();
    },
  },
};
