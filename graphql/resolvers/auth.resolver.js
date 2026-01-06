const AuthController = require("../../controllers/auth.controller");
const { requireAuth } = require('../../utils/authGuard');

module.exports = {
  Query: {
    me: async (_parent, args, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
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
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await AuthController.logout(ctx)
    },
  },
};
