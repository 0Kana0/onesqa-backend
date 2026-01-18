module.exports = `
  scalar DateTime

  type AiName {
    model_name: String!
    model_use_name: String!
    model_type: String!
  }

  # ✅ เพิ่มตัวนี้: สถิติรายโมเดลของกลุ่ม
  type GroupModelStat {
    ai_id: ID
    today: Int!     # ✅ tokensToday
    average: Int!   # ✅ average 

    token_count: Int
    token_all: Int
    
    ai: AiName
  }

  type GroupAi {
    id: ID!
    group_id: ID!
    ai_id: ID!
    init_token: Int
    createdAt: DateTime!
    updatedAt: DateTime!
    ai: AiName
  }

  type Group {
    id: ID!
    group_api_id: Int
    name: String
    code: String
    data_level: String
    academy_level_id: String
    status: Boolean
    ai_id: ID
    createdAt: DateTime!
    updatedAt: DateTime!

    ai: AiName
    group_ai: [GroupAi!]!

    user_count: Int

    # ✅ ใส่ตรงนี้เลย (แยกตาม Model)
    models: [GroupModelStat!]!
  }

  input GroupFilterInput {
    model_use_name: String
    search: String
  }

  type GroupPage {
    items: [Group!]!
    page: Int!
    pageSize: Int!
    totalCount: Int!
  }

  input GroupAiInput {
    ai_id: ID!
    init_token: Int
    plus_token: Int
    minus_token: Int
  }

  input GroupInput {
    ai_id: ID
    model_use_name: String
    status: Boolean
    group_ai: [GroupAiInput!]
  }

  extend type Query {
    groups(page: Int, pageSize: Int, where: GroupFilterInput): GroupPage!
    group(id: ID!): Group
    groupByName(name: String!): Group
    groupWithUserCount: [Group]
  }

  extend type Mutation {
    updateGroup(id: ID!, input: GroupInput!): Group!
    deleteGroup(id: ID!): Boolean!
  }
`;
