// graphql/resolvers/chat.resolver.js
const ChatController = require('../../controllers/chat.controller');
const { requireAuth } = require('../../utils/authGuard');

module.exports = {
  Query: {
    chats: async (_parent, { chatgroup_id, user_id, first = 20, after, search, chatgroupMode }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await ChatController.listChats(chatgroup_id, user_id, { first, after, search, chatgroupMode });
    },
    chat: async (_parent, { id, user_id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await ChatController.getChatById(id, user_id);
    },
  },
  Mutation: {
    createChat: async (_parent, { input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await ChatController.createChat(input);
    },
    updateChat: async (_parent, { id, input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await ChatController.updateChat(id, input, ctx);
    },
    deleteChat: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await ChatController.deleteChat(id);
    },
  },
};
