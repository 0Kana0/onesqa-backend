// graphql/resolvers/ai.resolver.js
const AiController = require('../../controllers/ai.controller');
const { requireAuth } = require('../../utils/authGuard');

module.exports = {
  Query: {
    ais: async (_parent, args, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await AiController.listAis();
    },
    ai: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await AiController.getAiById(id);
    },
  },
  Mutation: {
    createAi: async (_parent, { input }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await AiController.createAi(input, ctx);
    },
    updateAi: async (_parent, { id, input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await AiController.updateAi(id, input, ctx);
    },
    deleteAi: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await AiController.deleteAi(id);
    },
  },
};
