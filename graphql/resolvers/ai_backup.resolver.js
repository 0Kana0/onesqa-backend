// graphql/resolvers/ai_backup.resolver.js
const AiBackupController = require('../../controllers/ai_backup.controller');
const { requireAuth, checkUserInDB } = require('../../utils/authGuard');

module.exports = {
  Query: {
    ai_backups: async (_parent, { }, ctx) => {
      // requireAuth(ctx); // ต้องล็อกอินก่อน
      // await checkUserInDB(ctx);
      return await AiBackupController.listAiBackups();
    },
  },
};
