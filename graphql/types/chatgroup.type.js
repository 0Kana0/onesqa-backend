module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้

  type Chat {
    id: ID!
    chat_name: String!
    ai_id: ID!
    chatgroup_id: Int
    createdAt: DateTime!
    updatedAt: DateTime!
  }
  type Chatgroup {
    id: ID!
    chatgroup_name: String!
    createdAt: DateTime!
    updatedAt: DateTime!

    # 👇 ตารางลูก (relations)
    chat: [Chat!]!
  }
  type ChatgroupEdge {
    node: Chatgroup!
    cursor: String!
  }
  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }
  type ChatgroupConnection {
    edges: [ChatgroupEdge!]!
    pageInfo: PageInfo!
  }

  input ChatgroupInput {
    user_id: ID
    chatgroup_name: String
  }

  extend type Query {
    chatgroups(first: Int = 20, after: String, id: ID, user_id: ID!, search: String): ChatgroupConnection!
    chatgroup(id: ID!, user_id: ID): Chatgroup
  }

  extend type Mutation {
    createChatgroup(input: ChatgroupInput!): Chatgroup!
    updateChatgroup(id: ID!, input: ChatgroupInput!): Chatgroup!
    deleteChatgroup(id: ID!): Boolean!
  }
`;
