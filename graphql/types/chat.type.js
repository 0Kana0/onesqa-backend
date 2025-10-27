module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้

  type Chat {
    id: ID!
    chat_name: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  input ChatInput {
    chat_name: String
  }

  extend type Query {
    chats(chatgroup_id: ID!, user_id: ID!): [Chat!]!
    chat(id: ID!): Chat
  }

  extend type Mutation {
    createChat(input: ChatInput!): Chat!
    updateChat(id: ID!, input: ChatInput!): Chat!
    deleteChat(id: ID!): Boolean!
  }
`;
