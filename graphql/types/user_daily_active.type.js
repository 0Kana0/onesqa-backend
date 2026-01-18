module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้ 

  # ✅ ใช้กับ DataFilter/PeriodReportChart
  # mode: "daily" | "monthly" | "yearly"
  input PeriodInput {
    mode: String!
    date: DateTime
    month: Int
    year: Int
  }

  # ✅ events ที่ PeriodReportChart ใช้ได้ทันที
  type periodUsersActiveEvent {
    ts: DateTime!
    model_type: String!
    value: Int!
  }

  extend type Query {
    # ✅ เพิ่มใหม่: สำหรับกราฟตาม DataFilter (รายวัน/เดือน/ปี)
    periodUsersActive(period: PeriodInput!): [periodUsersActiveEvent!]!
  }
`;
