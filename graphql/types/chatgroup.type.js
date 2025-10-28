module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้

  type Chatgroup {
    id: ID!
    chatgroup_name: String!
    createdAt: DateTime!
    updatedAt: DateTime!
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
    chatgroups(first: Int = 20, after: String, user_id: ID!): ChatgroupConnection!
    chatgroup(id: ID!): Chatgroup
  }

  extend type Mutation {
    createChatgroup(input: ChatgroupInput!): Chatgroup!
    updateChatgroup(id: ID!, input: ChatgroupInput!): Chatgroup!
    deleteChatgroup(id: ID!): Boolean!
  }
`;
