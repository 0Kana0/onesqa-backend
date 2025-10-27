// graphql/resolvers/chatgroup.resolver.js
const ChatgroupController = require('../../controllers/chatgroup.controller');
const { requireAuth } = require('../../utils/authGuard');

module.exports = {
  Query: {
    chatgroups: async (_parent, { user_id }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await ChatgroupController.listChatgroups({ user_id });
    },
    chatgroup: async (_parent, { id }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await ChatgroupController.getChatgroupById(id);
    },
  },
  Mutation: {
    createChatgroup: async (_parent, { input }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await ChatgroupController.createChatgroup(input);
    },
    updateChatgroup: async (_parent, { id, input }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await ChatgroupController.updateChatgroup(id, input, ctx);
    },
    deleteChatgroup: async (_parent, { id }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await ChatgroupController.deleteChatgroup(id);
    },
  },
};
