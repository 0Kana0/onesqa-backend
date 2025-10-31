module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้ 

  type Report {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  extend type Query {
    reports: [Report!]!
  }

  extend type Mutation {

  }
`;
