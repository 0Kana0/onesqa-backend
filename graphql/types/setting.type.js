module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้

  type Setting {
    id: ID!
    setting_name: String!
    setting_detail: String!
    activity: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  input SettingInput {
    setting_name: String
    setting_detail: String
    activity: Boolean
  }

  extend type Query {
    settings: [Setting!]!
    setting(id: ID!): Setting
  }

  extend type Mutation {
    createSetting(input: SettingInput!): Setting!
    updateSetting(id: ID!, input: SettingInput!): Setting!
    deleteSetting(id: ID!): Boolean!
  }
`;
