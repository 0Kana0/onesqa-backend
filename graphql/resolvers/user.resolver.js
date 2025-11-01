const UserController = require('../../controllers/user.controller');
const { requireAuth } = require('../../utils/authGuard');

module.exports = {
  Query: {
    users: async (_p, { page, pageSize, where }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
			return await UserController.listUsers({ page, pageSize, where })
    },
    user: async (_p, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
			return await UserController.getByUserId(id)
    },
  },
	Mutation: {
		updateUser: async (_parent, { id, input }, ctx) => {
			requireAuth(ctx); // ต้องล็อกอินก่อน
			return await UserController.updateUser(id, input, ctx);
		},
		deleteUser: async (_parent, { id }, ctx) => {
			//requireAuth(ctx); // ต้องล็อกอินก่อน
			return await UserController.deleteUser(id);
		},
	}
};
