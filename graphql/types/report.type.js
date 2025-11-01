module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้ 

  type TopFiveReport {
    rank: Int!,
    color: String!,
    name: String!,
    chats: Int!,
    tokens: String!
  }

  type ChartReport {
    date: DateTime!,
    model: String!,
    total_tokens: Int!
  }

  type CardReport {
    value: Int!,
    percentChange: Int!
  }

  type Report {
    id: ID!,
    user_id: ID!,
    user: String!,
    position: String!,
    date: DateTime!,
    chats: Int!,
    tokens: String!
  }
  input ReportFilterInput {
    startDate: DateTime  # รวมเวลาได้ เช่น 2025-10-01T00:00:00
    endDate: DateTime    # แนะนำส่งสิ้นวัน (23:59:59.999) เพื่อให้ inclusive
  }
  # เดิม: type Report {...} ใช้เหมือนเดิม
  type ReportPage {
    items: [Report!]!
    page: Int!
    pageSize: Int!
    totalCount: Int!
  }

  extend type Query {
    reports(page: Int, pageSize: Int, where: ReportFilterInput): ReportPage!
    cardMessageReports: CardReport!
    cardTokenReports: CardReport!
    chartReports(startDate: DateTime, endDate: DateTime): [ChartReport!]!
    topFiveReports: [TopFiveReport!]!
  }
`;
