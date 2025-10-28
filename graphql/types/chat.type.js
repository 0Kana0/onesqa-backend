module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้

  type Chat {
    id: ID!
    chat_name: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }
  type ChatEdge {
    node: Chat!
    cursor: String!
  }
  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }
  type ChatConnection {
    edges: [ChatEdge!]!
    pageInfo: PageInfo!
  }

  input ChatInput {
    chatgroup_id: ID
    user_id: ID
    ai_id: ID
    chat_name: String
  }

  extend type Query {
    chats(first: Int = 20, after: String, chatgroup_id: ID, user_id: ID!): ChatConnection!
    chat(id: ID!): Chat
  }

  extend type Mutation {
    createChat(input: ChatInput!): Chat!
    updateChat(id: ID!, input: ChatInput!): Chat!
    deleteChat(id: ID!): Boolean!
  }
`;
