module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้

  enum MessageType {
    TEXT
    IMAGE
    VIDEO
    DOC
  }

  type Ai {
    id: ID!
    model_name: String!
    model_use_name: String!
    model_type: String!
    message_type: MessageType
    token_count: Int!
    token_all: Int
    activity: Boolean!
    today: Int!
    average: Int!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  # ✅ ผลรวม token ของผู้ใช้ทั้งหมดต่อ 1 model (ai_id)
  type TokenSummaryByModel {
    ai_id: ID!
    model_name: String!
    model_use_name: String!
    model_type: String!
    message_type: MessageType

    # ✅ token_count จากตาราง ai
    ai_token_count: Int!

    # ✅ ผลรวมจาก user_ai
    total_token_count: Int!
    total_token_all: Int

    # ✅ จำนวน user ที่มี record ใน model นี้
    user_count: Int!

    # ✅ ผลต่างระหว่าง ai.token_count กับ total_token_count
    diff_token_count: Int!
  }

  input AiInput {
    model_name: String
    model_use_name: String
    model_type: String
    message_type: MessageType
    token_count: Int
    token_all: Int
    activity: Boolean
  }

  extend type Query {
    ais(message_type: MessageType): [Ai!]!
    ai(id: ID!): Ai
    sumTokenCountByModel: [TokenSummaryByModel!]!
  }

  extend type Mutation {
    createAi(input: AiInput!): Ai!
    updateAi(id: ID!, input: AiInput!): Ai!
    deleteAi(id: ID!): Boolean!
  }
`;
