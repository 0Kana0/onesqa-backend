// graphql/resolvers/prompt.resolver.js
const PromptController = require('../../controllers/prompt.controller');
const { requireAuth, checkUserInDB } = require('../../utils/authGuard');

module.exports = {
  Query: {
    prompts: async (_parent, { locale }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await PromptController.listPrompts(locale);
    },
    prompt: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await PromptController.getPromptById(id);
    },
  },
  Mutation: {
    createPrompt: async (_parent, { input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await PromptController.createPrompt(input, ctx);
    },
    updatePrompt: async (_parent, { id, input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await PromptController.updatePrompt(id, input, ctx);
    },
    deletePrompt: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await PromptController.deletePrompt(id, ctx);
    },
  },
};
