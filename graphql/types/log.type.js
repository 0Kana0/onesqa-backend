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

  input LogInput {
    edit_name: String!
    log_type: LogType!
    old_data: String!
    new_data: String!
    old_status: Boolean
    new_status: Boolean
  }

  extend type Query {
    logs: [Log!]!
    log(id: ID!): Log
  }

  extend type Mutation {
    createLog(input: LogInput!): Log!
    updateLog(id: ID!, input: LogInput!): Log!
    deleteLog(id: ID!): Boolean!
    deleteLogs: Boolean!
  }
`;
