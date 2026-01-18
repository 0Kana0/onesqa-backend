// graphql/resolvers/role.resolver.js
const RoleController = require('../../controllers/role.controller');
const { requireAuth, checkUserInDB } = require('../../utils/authGuard');

module.exports = {
  Query: {
    roles: async (_parent, args, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await RoleController.listRoles();
    },
    role: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await RoleController.getRoleById(id);
    },
  },
  Mutation: {
    createRole: async (_parent, { input }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      //await checkUserInDB(ctx);
      return await RoleController.createRole(input, ctx);
    },
    updateRole: async (_parent, { id, input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await RoleController.updateRole(id, input, ctx);
    },
    deleteRole: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await RoleController.deleteRole(id);
    },
  },
};
