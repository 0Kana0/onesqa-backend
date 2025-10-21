// graphql/resolvers/setting.resolver.js
const SettingController = require('../../controllers/setting.controller');
const { requireAuth } = require('../../utils/authGuard');

module.exports = {
  Query: {
    settings: async (_parent, args, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await SettingController.listSettings();
    },
    setting: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await SettingController.getSettingById(id);
    },
  },
  Mutation: {
    createSetting: async (_parent, { input }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await SettingController.createSetting(input);
    },
    updateSetting: async (_parent, { id, input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await SettingController.updateSetting(id, input, ctx);
    },
    deleteSetting: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await SettingController.deleteSetting(id);
    },
  },
};
