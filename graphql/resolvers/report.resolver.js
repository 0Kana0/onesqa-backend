// graphql/resolvers/role.resolver.js
const ReportController = require('../../controllers/report.controller');
const { requireAuth } = require('../../utils/authGuard');

module.exports = {
  Query: {
    reports: async (_parent, args, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await ReportController.listReports();
    },
  },
  Mutation: {

  },
};
