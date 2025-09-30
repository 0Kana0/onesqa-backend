const AuthController = require("../../controllers/auth.controller");

module.exports = {
  Mutation: {
    signin: async (_p, { input }, ctx) => {
      return await AuthController.signin(input, ctx)
    },
    signinWithIdennumber: async (_p, { input }, ctx) => {
      return await AuthController.signinWithIdennumber(input, ctx)
    },
    verifySigninWithIdennumber: async (_p, { input }, ctx) => {
      return await AuthController.verifySigninWithIdennumber(input, ctx)
    },
    refreshToken: async (_p, _a, ctx) => {
      return await AuthController.refreshToken(ctx)
    },
    logout: async (_p, _a, ctx) => {
      return await AuthController.logout(ctx)
    },
  },
};
