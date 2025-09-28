// graphql/resolvers/ai.resolver.js
const AiController = require('../../controllers/ai.controller');

module.exports = {
  Query: {
    ais: async (_parent, args) => {
      return await AiController.listAis();
    },
    ai: async (_parent, { id }) => {
      return await AiController.getAiById(id);
    },
  },
  Mutation: {
    createAi: async (_parent, { input }) => {
      return await AiController.createAi(input);
    },
    updateAi: async (_parent, { id, input }) => {
      return await AiController.updateAi(id, input);
    },
    deleteAi: async (_parent, { id }) => {
      return await AiController.deleteAi(id);
    },
  },
};
