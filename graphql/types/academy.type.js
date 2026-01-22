module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้
  scalar JSON

  type AcademyCount {
    academy_level_id: Int
    count: Int
  }

  type Academy {
    id: ID!
    academy_api_id: Int
    name: String
    code: String
    academy_level_id: String
    sar_file: JSON
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type SyncAcademy {
    message: String!
    status: String!
  }

  type RemoveSarFilesResult {
    ok: Boolean!
    removedCount: Int!
    academy: Academy
  }

  extend type Query {
    countByAcademyLevel: [AcademyCount!]!
    academyByCode(code: String): Academy
    academyByCodeChat(code: String): Academy
  }

  extend type Mutation {
    syncAcademyFromApi: SyncAcademy
    removeSarFiles(academy_id: ID!, files: [String!]!): RemoveSarFilesResult!
  }
`;
