module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้

  type Ai {
    id: ID!
    model_name: String!
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
    token_count: Int!
    token_all: Int
    activity: Boolean!
  }

  extend type Query {
    ais: [Ai!]!
    ai(id: ID!): Ai
  }

  extend type Mutation {
    createAi(input: AiInput!): Ai!
    updateAi(id: ID!, input: AiInput!): Ai!
    deleteAi(id: ID!): Boolean!
  }
`;
