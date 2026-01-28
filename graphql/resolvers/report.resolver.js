// graphql/resolvers/role.resolver.js
const ReportController = require('../../controllers/report.controller');
const { requireAuth, checkUserInDB } = require('../../utils/authGuard');

module.exports = {
  Query: {
    reports: async (_parent, { page, pageSize, where }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await ReportController.listReports({ page, pageSize, where });
    },
    periodReports: async (_parent, { page, pageSize, period, search }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await ReportController.listReportsByPeriod({ page, pageSize, period, search });
    },
    cardMessageReports: async (_parent, args, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await ReportController.CardMessageReports();
    },
    cardTokenReports: async (_parent, args, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await ReportController.CardTokenReports();
    },
    chartReports: async (_parent, { startDate, endDate  }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await ReportController.ChartReports({ startDate, endDate });
    },
    periodChartReports: async (_parent, { period }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await ReportController.PeriodChartReports({ period });
    },
    topFiveReports: async (_parent, { month, year }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await ReportController.TopFiveReports({ month, year });
    },
  },
};
