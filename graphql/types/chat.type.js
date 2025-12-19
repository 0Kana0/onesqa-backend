module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้

  type AiName {
    model_name: String!
    model_use_name: String!
    model_type: String!
  }
  type Chat {
    id: ID!
    chat_name: String!
    ai_id: ID!
    chatgroup_id: Int
    createdAt: DateTime!
    updatedAt: DateTime!

    ai: AiName
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
    chats(first: Int = 20, after: String, chatgroup_id: ID, user_id: ID!, search: String, chatgroupMode: String): ChatConnection!
    chat(id: ID!, user_id: ID): Chat
  }

  extend type Mutation {
    createChat(input: ChatInput!): Chat!
    updateChat(id: ID!, input: ChatInput!): Chat!
    deleteChat(id: ID!): Boolean!
  }
`;
