module.exports = `
  type UserStatus {
    user_id: ID!
    username: String!
    is_online: Boolean!
  }

  extend type Query {
    onlineUsers: [UserStatus!]!
  }

  extend type Mutation {
    setUserOnline(user_id: ID!): UserStatus!
    setUserOffline(user_id: ID!): UserStatus
  }

  type Subscription {
    userStatusChanged: UserStatus!
  }
`;