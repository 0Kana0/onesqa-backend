module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้ 

  type Role {
    id: ID!
    role_name: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  input RoleInput {
    role_name: String!
  }

  extend type Query {
    roles: [Role!]!
    role(id: ID!): Role
  }

  extend type Mutation {
    createRole(input: RoleInput!): Role!
    updateRole(id: ID!, input: RoleInput!): Role!
    deleteRole(id: ID!): Boolean!
  }
`;
