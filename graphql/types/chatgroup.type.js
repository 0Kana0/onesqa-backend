module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้

  type Chatgroup {
    id: ID!
    chatgroup_name: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  input ChatgroupInput {
    chatgroup_name: String
  }

  extend type Query {
    chatgroups(user_id: ID!): [Chatgroup!]!
    chatgroup(id: ID!): Chatgroup
  }

  extend type Mutation {
    createChatgroup(input: ChatgroupInput!): Chatgroup!
    updateChatgroup(id: ID!, input: ChatgroupInput!): Chatgroup!
    deleteChatgroup(id: ID!): Boolean!
  }
`;
