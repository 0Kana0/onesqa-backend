module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้

  type Message {
    id: ID!
    role: String!
    text: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  input MessageInput {
    role: String
    text: String
  }

  extend type Query {
    messages(chat_id: ID!): [Message!]!
    message(id: ID!): Message
  }

  extend type Mutation {
    createMessage(input: MessageInput!): Message!
    updateMessage(id: ID!, input: MessageInput!): Message!
    deleteMessage(id: ID!): Boolean!
  }
`;
