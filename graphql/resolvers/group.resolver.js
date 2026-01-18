// graphql/resolvers/group.resolver.js
const GroupController = require('../../controllers/group.controller');
const { requireAuth, checkUserInDB } = require('../../utils/authGuard');

module.exports = {
  Query: {
    groups: async (_parent, { page, pageSize, where }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await GroupController.listGroups({ page, pageSize, where });
    },
    group: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await GroupController.getGroupById(id);
    },
    groupByName: async (_parent, { name }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await GroupController.getGroupByName(name);
    },
    groupWithUserCount: async (_parent, {  }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await GroupController.getAllGroupsWithUserCount();
    },
  },
  Mutation: {
    updateGroup: async (_parent, { id, input }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await GroupController.updateGroup(id, input, ctx);
    },
    deleteGroup: async (_parent, { id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await GroupController.deleteGroup(id);
    },
  },
};
