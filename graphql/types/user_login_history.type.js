module.exports = `
  scalar DateTime

  enum EventType {
    LOGIN_SUCCESS
    LOGOUT
  }

  type RoleName {
    role_name_th: String!
    role_name_en: String!
  }

  type UserRole {
    id: ID!
    user_id: ID!
    role_id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!

    role: RoleName
  }

  type User {
    id: ID!
    firstname: String!
    lastname: String!
    username: String!
    phone: String!
    email: String!
    login_type: LoginType!
    locale: localeMode!
    alert: Boolean!
    is_online: Boolean!
    position: String!
    group_name: String!
    ai_access: Boolean!
    color_mode: ColorMode!
    loginAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!

    user_role: [UserRole!]!
  }

  type UserLoginHistory {
    id: ID!
    user_id: ID!
    event_type: EventType!
    user_agent: String!
    createdAt: DateTime!
    updatedAt: DateTime!

    user: User!
  }

  input UserLoginHistoryFilterInput {
    search: String
    event_type: EventType     # ✅ แก้จาก LoginType -> EventType
    startDate: DateTime
    endDate: DateTime
  }

  type UserLoginHistoryPage {
    items: [UserLoginHistory!]!
    page: Int!
    pageSize: Int!
    totalCount: Int!
  }

  extend type Query {
    loginHistory(
      page: Int
      pageSize: Int
      where: UserLoginHistoryFilterInput
    ): UserLoginHistoryPage!
  }

  extend type Mutation {
    deleteLoginHistorys: Boolean!
  }
`;
