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
  }

  extend type Mutation {
    createAi(input: AiInput!): Ai!
    updateAi(id: ID!, input: AiInput!): Ai!
    deleteAi(id: ID!): Boolean!
  }
`;
