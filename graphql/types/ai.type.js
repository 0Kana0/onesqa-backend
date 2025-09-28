module.exports = `
  type Ai {
    id: ID!
    model_name: String!
    token_count: Int!
    activity: Boolean!
    createdAt: String!
    updatedAt: String!
  }

  input CreateAiInput {
    model_name: String!
    token_count: Int!
    activity: Boolean!
  }

  input UpdateAiInput {
    model_name: String
    token_count: Int
    activity: Boolean
  }

  extend type Query {
    ais: [Ai!]!
    ai(id: ID!): Ai
  }

  extend type Mutation {
    createAi(input: CreateAiInput!): Ai!
    updateAi(id: ID!, input: UpdateAiInput!): Ai!
    deleteAi(id: ID!): Boolean!
  }
`;
