// graphql/resolvers/message.resolver.js
const MessageController = require('../../controllers/message.controller');
const { requireAuth, checkUserInDB } = require('../../utils/authGuard');

module.exports = {
  Query: {
    messages: async (_parent, { chat_id, user_id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await MessageController.listMessages({ chat_id, user_id });
    },
    message: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await MessageController.getMessageById(id);
    },
  },
  Mutation: {
    createMessage: async (_parent, { input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await MessageController.createMessage(input, ctx);
    },
    createMessageImage: async (_parent, { input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await MessageController.createMessageImage(input, ctx);
    },
    createMessageVideo: async (_parent, { input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await MessageController.createMessageVideo(input, ctx);
    },
    createMessageDoc: async (_parent, { input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await MessageController.createMessageDoc(input, ctx);
    },
    updateMessage: async (_parent, { id, input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await MessageController.updateMessage(id, input, ctx);
    },
    deleteMessage: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await MessageController.deleteMessage(id);
    },
  },
};
