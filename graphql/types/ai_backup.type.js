module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้

  enum MessageType {
    TEXT
    IMAGE
    VIDEO
    DOC
  }

  type AiBackup {
    id: ID!
    model_name: String!
    model_use_name: String!
    model_type: String!
    message_type: MessageType
    token_count: Int!
    token_all: Int
    activity: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  extend type Query {
    ai_backups: [AiBackup!]!
  }
`;
