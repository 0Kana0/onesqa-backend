module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้

  enum LoginType {
    NORMAL
    INSPEC
  }
  enum ColorMode {
    LIGHT
    DARK
  }
  enum localeMode {
    th
    en
  }

  type RoleName {
    role_name: String!
  }
  type UserRole {
    id: ID!
    user_id: ID!
    role_id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!

    role: RoleName
  }

  type AiName {
    model_name: String!
  }
  type UserAi {
    id: ID!
    user_id: ID!
    ai_id: ID!
    token_count: Int
    token_all: Int
    today: Int!
    average: Int!
    createdAt: DateTime!
    updatedAt: DateTime!

    ai: AiName
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
    loginAt: DateTime!
    createdAt: DateTime!
    updatedAt: DateTime!

    # 👇 ตารางลูก (relations)
    user_role: [UserRole!]!
    user_ai: [UserAi!]!
  }


  input UserRoleInput {
    role_id: ID!
  }
  input UserAiInput {
    ai_id: ID!
    token_count: Int
    token_all: Int
  }

  input UserInput {
    firstname: String
    lastname: String
    phone: String
    email: String
    position: String
    group_name: String
    ai_access: Boolean
    color_mode: ColorMode
    locale: localeMode
    alert: Boolean
    is_online: Boolean
    
    # 👇 ตารางลูก (relations)
    user_role: [UserRoleInput!]
    user_ai: [UserAiInput!]
  }

  extend type Query {
    users: [User!]!
    user(id: ID!): User
  }

  extend type Mutation {
    updateUser(id: ID!, input: UserInput!): User!
    deleteUser(id: ID!): Boolean!
  }
`;
