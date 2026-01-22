module.exports = `
  scalar DateTime

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

  type SarHistory {
    id: ID!
    delete_name: String!
    sar_file: String!
    createdAt: DateTime!
    updatedAt: DateTime!

    academy: Academy!
  }

  input SarHistoryFilterInput {
    search: String
    startDate: DateTime
    endDate: DateTime
  }

  type SarHistoryPage {
    items: [SarHistory!]!
    page: Int!
    pageSize: Int!
    totalCount: Int!
  }

  extend type Query {
    sarHistory(
      page: Int
      pageSize: Int
      where: SarHistoryFilterInput
    ): SarHistoryPage!
  }
`;
