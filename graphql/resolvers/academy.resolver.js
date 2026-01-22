// graphql/resolvers/academy.resolver.js
const AcademyController = require('../../controllers/academy.controller');
const { requireAuth, checkUserInDB } = require('../../utils/authGuard');

module.exports = {
  Query: {
    countByAcademyLevel: async (_parent, {  }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await AcademyController.countByAcademyLevel();
    },
    academyByCode: async (_parent, { code }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await AcademyController.getAcademyByCode(code);
    },
    academyByCodeChat: async (_parent, { code }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await AcademyController.getAcademyByCodeChat(code);
    },
  },
  Mutation: {
    syncAcademyFromApi: async (_parent, {  }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await AcademyController.syncAcademyFromApi(ctx);
    },
    removeSarFiles: async (_, { academy_id, files }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await AcademyController.removeSarFiles({ academy_id, files, ctx });
    },
  },
};
