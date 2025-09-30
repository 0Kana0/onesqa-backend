module.exports = `
  type Ai {
    id: ID!
    model_name: String!
    token_count: Int!
    activity: Boolean!
    createdAt: String!
    updatedAt: String!
  }

  input AiInput {
    model_name: String!
    token_count: Int!
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
