// graphql/resolvers/chatgroup.resolver.js
const ChatgroupController = require('../../controllers/chatgroup.controller');
const { requireAuth, checkUserInDB } = require('../../utils/authGuard');

module.exports = {
  Query: {
    chatgroups: async (_parent, { id, user_id, first = 20, after, search }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await ChatgroupController.listChatgroups(id, user_id, { first, after, search });
    },
    chatgroup: async (_parent, { id, user_id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await ChatgroupController.getChatgroupById(id, user_id);
    },
  },
  Mutation: {
    createChatgroup: async (_parent, { input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await ChatgroupController.createChatgroup(input);
    },
    updateChatgroup: async (_parent, { id, input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await ChatgroupController.updateChatgroup(id, input, ctx);
    },
    deleteChatgroup: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB (ctx);
      return await ChatgroupController.deleteChatgroup(id);
    },
  },
};
