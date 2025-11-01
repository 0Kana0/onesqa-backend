// graphql/resolvers/type.resolver.js
const LogController = require('../../controllers/log.controller');
const { requireAuth } = require('../../utils/authGuard');

module.exports = {
  Query: {
    logs: async (_parent, { page, pageSize, where }, ctx) => {
      requireAuth(ctx);
      return await LogController.listLogs({ page, pageSize, where });
    },
    log: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await LogController.getLogById(id);
    },
  },
  Mutation: {
    createLog: async (_parent, { input }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await LogController.createLog(input);
    },
    updateLog: async (_parent, { id, input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await LogController.updateLog(id, input);
    },
    deleteLog: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await LogController.deleteLog(id);
    },
    deleteLogs: async (_paren, args, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await LogController.deleteLogs();
    },
  },
};
