module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้

  enum LogType {
    PROMPT
    ALERT 
    MODEL
    PERSONAL 
    GROUP
  }

  type Log {
    id: ID!
    edit_name: String!
    log_type: LogType!
    old_data: String!
    new_data: String!
    old_status: Boolean
    new_status: Boolean
    createdAt: DateTime!
    updatedAt: DateTime!
  }
  input LogFilterInput {
    logType: LogType
    startDate: DateTime  # รวมเวลาได้ เช่น 2025-10-01T00:00:00
    endDate: DateTime    # แนะนำส่งสิ้นวัน (23:59:59.999) เพื่อให้ inclusive
  }
  # เดิม: type Log {...} ใช้เหมือนเดิม
  type LogPage {
    items: [Log!]!
    page: Int!
    pageSize: Int!
    totalCount: Int!
  }

  input LogInput {
    edit_name: String!
    log_type: LogType!
    old_data: String!
    new_data: String!
    old_status: Boolean
    new_status: Boolean
  }

  extend type Query {
    # ใช้งานจริงแนะนำตัวนี้
    logs(page: Int = 1, pageSize: Int = 20, where: LogFilterInput): LogPage!
    log(id: ID!): Log
  }

  extend type Mutation {
    createLog(input: LogInput!): Log!
    updateLog(id: ID!, input: LogInput!): Log!
    deleteLog(id: ID!): Boolean!
    deleteLogs: Boolean!
  }
`;
