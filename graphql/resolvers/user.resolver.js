const UserController = require('../../controllers/user.controller');
const { requireAuth, checkUserInDB } = require('../../utils/authGuard');

module.exports = {
  Query: {
    users: async (_p, { page, pageSize, where }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
			return await UserController.listUsers({ page, pageSize, where })
    },
    user: async (_p, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
			return await UserController.getByUserId(id)
    },
  },
	Mutation: {
		updateUser: async (_parent, { id, input }, ctx) => {
			requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
			return await UserController.updateUser(id, input, ctx);
		},
    updateThemeAndLocale: async (_parent, { id, input }, ctx) => {
			requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
			return await UserController.updateThemeAndLocale(id, input);
		},
		deleteUser: async (_parent, { id }, ctx) => {
			//requireAuth(ctx); // ต้องล็อกอินก่อน
      //await checkUserInDB(ctx);
			return await UserController.deleteUser(id);
		},
    syncUsersFromApi: async (_parent, {  }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
			return await UserController.syncUsersFromApi(ctx)
    },
	}
};
