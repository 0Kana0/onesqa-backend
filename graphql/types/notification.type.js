module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้ 

  type Notification {
    id: ID!
    title: String!
    message: String!
    type: String!
    user_id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
  }
  type NotificationEdge {
    node: Notification!
    cursor: String!
  }
  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }
  type NotificationConnection {
    edges: [NotificationEdge!]!
    pageInfo: PageInfo!
  }

  input NotificationInput {
    title: String
    message: String
    type: String
    user_id: ID!
  }
  
  extend type Query {
    # ใช้สำหรับ infinite scroll: เรียกเพิ่มด้วย after = endCursor เดิม
    myNotifications(first: Int = 20, after: String, user_id: ID!): NotificationConnection!
  }

  extend type Mutation {
    createNotification(input: NotificationInput!): Notification!
  }

  type Subscription {
    notificationAdded(user_id: ID!): Notification!
  }
`;
