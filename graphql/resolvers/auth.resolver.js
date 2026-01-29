const AuthController = require("../../controllers/auth.controller");
const { requireAuth, checkUserInDB } = require('../../utils/authGuard');

module.exports = {
  Query: {
    me: async (_parent, args, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await AuthController.me(ctx);
    },
  },
  Mutation: {
    signin: async (_parent, { input }, ctx) => {
      return await AuthController.signin(input, ctx)
    },
    signinWithIdennumber: async (_parent, { input }, ctx) => {
      return await AuthController.signinWithIdennumber(input, ctx)
    },
    verifySigninWithIdennumber: async (_parent, { input }, ctx) => {
      return await AuthController.verifySigninWithIdennumber(input, ctx)
    },
    refreshToken: async (_parent, _a, ctx) => {
      return await AuthController.refreshToken(ctx)
    },
    logout: async (_parent, _a, ctx) => {
      return await AuthController.logout(ctx)
    },
    signinFromAQA: async (_parent, { username, aqa_code }, ctx) => {
      return await AuthController.signinFromAQA(username, aqa_code, ctx)
    },
  },
};
