module.exports = `
  scalar Upload

  type File {
    id: ID!
    original_name: String!
    filename: String!
    mimetype: String!
    encoding: String!
    stored_path: String!
    size: Int!
  }

  type Mutation {
    singleUpload(file: Upload!): File!
    multipleUpload(files: [Upload!]!): [File!]!
  }
`;
