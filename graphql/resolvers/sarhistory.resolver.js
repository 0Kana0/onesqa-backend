// graphql/resolvers/sarhistory.resolver.js
const SarHistoryController = require('../../controllers/sarhistory.controller');
const { requireAuth, checkUserInDB } = require('../../utils/authGuard');

module.exports = {
  Query: {
    sarHistory: async (_p, { page, pageSize, where }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await SarHistoryController.listSarHistory({ page, pageSize, where });
    },
  },
};
