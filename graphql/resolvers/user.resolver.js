const UserController = require('../../controllers/user.controller');
const { requireAuth } = require('../../utils/authGuard');

module.exports = {
  Query: {
    users: async (_p, args, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
			return await UserController.listUsers()
    },
    user: async (_p, { id }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
			return await UserController.getByUserId(id)
    },
  },
	Mutation: {
		updateUser: async (_parent, { id, input }, ctx) => {
			//requireAuth(ctx); // ต้องล็อกอินก่อน
			return await UserController.updateUser(id, input);
		},
		deleteUser: async (_parent, { id }, ctx) => {
			//requireAuth(ctx); // ต้องล็อกอินก่อน
			return await UserController.deleteUser(id);
		},
	}
};
