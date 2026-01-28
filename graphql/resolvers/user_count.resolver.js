// graphql/resolvers/user_count.resolver.js
const UserCountController = require('../../controllers/user_count.controller');
const { requireAuth, checkUserInDB } = require('../../utils/authGuard');

module.exports = {
  Query: {
    cardUserCountReports: async (_parent, args, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await UserCountController.CardUserCountReports();
    },
    // ✅ เพิ่มอันนี้: กราฟจำนวนผู้ใช้รายวัน
    chartUserCountReports: async (_parent, { startDate, endDate }, ctx) => {
      requireAuth(ctx);
      await checkUserInDB(ctx);
      return await UserCountController.ChartUserCountReports({ startDate, endDate });
    },
  },
};
