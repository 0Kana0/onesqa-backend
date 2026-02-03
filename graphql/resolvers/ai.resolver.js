// graphql/resolvers/ai.resolver.js
const AiController = require('../../controllers/ai.controller');
const { requireAuth, checkUserInDB } = require('../../utils/authGuard');

module.exports = {
  Query: {
    ais: async (_parent, { message_type }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await AiController.listAis(message_type);
    },
    ai: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await AiController.getAiById(id);
    },
    sumTokenCountByModel: async (_parent, {  }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await AiController.sumTokenCountByModel();
    },
  },
  Mutation: {
    createAi: async (_parent, { input }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      //await checkUserInDB(ctx);
      return await AiController.createAi(input, ctx);
    },
    updateAi: async (_parent, { id, input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await AiController.updateAi(id, input, ctx);
    },
    deleteAi: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await AiController.deleteAi(id);
    },
  },
};
