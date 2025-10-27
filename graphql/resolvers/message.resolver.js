// graphql/resolvers/message.resolver.js
const MessageController = require('../../controllers/message.controller');
const { requireAuth } = require('../../utils/authGuard');

module.exports = {
  Query: {
    messages: async (_parent, { chat_id }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await MessageController.listMessages({ chat_id });
    },
    message: async (_parent, { id }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await MessageController.getMessageById(id);
    },
  },
  Mutation: {
    createMessage: async (_parent, { input }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await MessageController.createMessage(input);
    },
    updateMessage: async (_parent, { id, input }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await MessageController.updateMessage(id, input, ctx);
    },
    deleteMessage: async (_parent, { id }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await MessageController.deleteMessage(id);
    },
  },
};
