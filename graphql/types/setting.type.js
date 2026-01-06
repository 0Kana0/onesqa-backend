module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้

  type Setting {
    id: ID!
    setting_name_th: String!
    setting_name_en: String!
    setting_detail_th: String!
    setting_detail_en: String!
    activity: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  input SettingInput {
    setting_name_th: String
    setting_name_en: String
    setting_detail_th: String
    setting_detail_en: String
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
