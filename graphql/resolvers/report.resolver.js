// graphql/resolvers/role.resolver.js
const ReportController = require('../../controllers/report.controller');
const { requireAuth } = require('../../utils/authGuard');

module.exports = {
  Query: {
    reports: async (_parent, { page, pageSize, where }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await ReportController.listReports({ page, pageSize, where });
    },
    cardMessageReports: async (_parent, args, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await ReportController.CardMessageReports();
    },
    cardTokenReports: async (_parent, args, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await ReportController.CardTokenReports();
    },
    chartReports: async (_parent, { startDate, endDate  }, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await ReportController.ChartReports({ startDate, endDate  });
    },
    topFiveReports: async (_parent, args, ctx) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await ReportController.TopFiveReports();
    },
  },
};
