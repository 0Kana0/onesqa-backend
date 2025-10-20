// graphql/resolvers/role.resolver.js
const RoleController = require('../../controllers/role.controller');
const { requireAuth } = require('../../utils/authGuard');

module.exports = {
  Query: {
    roles: async (_parent, args, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await RoleController.listRoles();
    },
    role: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await RoleController.getRoleById(id);
    },
  },
  Mutation: {
    createRole: async (_parent, { input }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await RoleController.createRole(input);
    },
    updateRole: async (_parent, { id, input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await RoleController.updateRole(id, input);
    },
    deleteRole: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      return await RoleController.deleteRole(id);
    },
  },
};
