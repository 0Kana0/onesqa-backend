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

  input NotificationInput {
    title: String
    message: String
    type: String
    user_id: ID!
  }
  
  extend type Query {
    myNotifications(user_id: ID!): [Notification]
  }

  extend type Mutation {
    createNotification(input: NotificationInput!): Notification!
  }

  type Subscription {
    notificationAdded(user_id: ID!): Notification!
  }
`;
