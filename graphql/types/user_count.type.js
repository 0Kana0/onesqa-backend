module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้ 

  type CardReport {
    value: Int,
    percentChange: Float
  }

  # ✅ NEW: กราฟจำนวนผู้ใช้รายวัน (User_count)
  type UserCountChartPoint {
    date: DateTime!
    total_user: Int!
  }

  extend type Query {
    cardUserCountReports: CardReport!
    chartUserCountReports(startDate: DateTime, endDate: DateTime): [UserCountChartPoint!]!
  }
`;
