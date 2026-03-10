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
  enum MessageType {
    TEXT
    IMAGE
    VIDEO
    DOC
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

  type AiName {
    model_name: String!
    model_use_name: String!
    model_type: String!
    message_type: MessageType
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
    loginAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!

    # 👇 ตารางลูก (relations)
    user_role: [UserRole!]!
    user_ai: [UserAi!]!
  }
  input UserFilterInput {
    role: String     # ตรงกับ Role.role_name (เช่น "ADMIN", "STAFF")
    status: String   # "ONLINE" | "OFFLINE" หรือ "true"/"false" ก็ได้
    search: String   # 👈 เพิ่มช่องค้นหา
  }
  # เดิม: type Log {...} ใช้เหมือนเดิม
  type UserPage {
    items: [User!]!
    page: Int!
    pageSize: Int!
    totalCount: Int!
  }

  type SyncUser {
    totalUsersFromApis: Int
    staffApiCount: Int
    assessorApiCount: Int
  }

  input UserRoleInput {
    role_id: ID!
    role_name_th: String
    role_name_en: String
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
  input ThemeAndLocaleInput {
    color_mode: ColorMode
    locale: localeMode
    alert: Boolean
  }

  input UserTokenModelInput {
    model: String!       # ชื่อ model จาก header (ตัดคำว่า Token แล้ว)
    token_count: Int     # token ที่จะตั้งค่า (จะอัปเดตเฉพาะที่เปลี่ยน)
  }

  input UpdateUsersTokenRowInput {
    name: String
    group_name: String
    ai_access: Boolean
    models: [UserTokenModelInput!]!
  }

  extend type Query {
    users(page: Int, pageSize: Int, where: UserFilterInput): UserPage!
    user(id: ID!): User
  }

  extend type Mutation {
    updateUser(id: ID!, input: UserInput!): User!
    updateUsers(input: [UpdateUsersTokenRowInput!]!): [User!]!
    updateThemeAndLocale(id: ID!, input: ThemeAndLocaleInput!): User!
    deleteUser(id: ID!): Boolean!
    syncUsersFromApi: SyncUser
  }
`;
