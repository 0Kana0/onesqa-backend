module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้ 

  type TopFiveReport {
    rank: Int,
    color: String,
    name: String,
    chats: Int,
    tokens: String
  }

  type ChartReport {
    date: DateTime,
    model: String,
    total_tokens: Int
  }

  type CardReport {
    value: Int,
    percentChange: Float
  }

  type Report {
    id: ID!,
    user_id: ID!,
    user: String!,
    group: String!,
    date: DateTime!,
    chats: Int!,
    tokens: String!
  }
  input ReportFilterInput {
    startDate: DateTime  # รวมเวลาได้ เช่น 2025-10-01T00:00:00
    endDate: DateTime    # แนะนำส่งสิ้นวัน (23:59:59.999) เพื่อให้ inclusive
    search: String   # 👈 เพิ่มช่องค้นหา
  }
  # เดิม: type Report {...} ใช้เหมือนเดิม
  type ReportPage {
    items: [Report!]!
    page: Int!
    pageSize: Int!
    totalCount: Int!
  }

  # ✅ ใช้กับ DataFilter/PeriodReportChart
  # mode: "daily" | "monthly" | "yearly"
  input PeriodInput {
    mode: String!
    date: DateTime
    month: Int
    year: Int
  }

  # ✅ events ที่ PeriodReportChart ใช้ได้ทันที
  type PeriodChartEvent {
    ts: DateTime!
    model_type: String!
    value: Int!
  }

  # ✅ NEW: รายการตารางแบบ period (daily/weekly/monthly)
  type PeriodReportRow {
    id: ID!
    user_id: ID!
    user: String!
    group: String!
    period: String!        # daily: "YYYY-MM-DD", monthly: "01-07", yearly: "YYYY-MM"
    period_start: DateTime!# ใช้ sort/แปลงชื่อเดือนใน FE
    chats: Int!
    tokens: String!        # คงแบบเดิม (string) กัน schema พัง
  }

  # ✅ NEW: page wrapper
  type PeriodReportPage {
    items: [PeriodReportRow!]!
    page: Int!
    pageSize: Int!
    totalCount: Int!
  }

  extend type Query {
    reports(page: Int, pageSize: Int, where: ReportFilterInput): ReportPage!
    # ✅ NEW: ตารางตาม DataFilter
    periodReports(page: Int, pageSize: Int, period: PeriodInput!, search: String): PeriodReportPage!
    cardMessageReports: CardReport!
    cardTokenReports: CardReport!
    chartReports(startDate: DateTime, endDate: DateTime): [ChartReport!]!
    # ✅ เพิ่มใหม่: สำหรับกราฟตาม DataFilter (รายวัน/เดือน/ปี)
    periodChartReports(period: PeriodInput!): [PeriodChartEvent!]!
    topFiveReports: [TopFiveReport!]!
  }
`;
