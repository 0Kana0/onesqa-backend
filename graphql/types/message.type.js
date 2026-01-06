module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้

  type Files {
    id: ID
    file_name: String
    original_name: String
    stored_path: String
  }
  type Message {
    id: ID!
    role: String!
    text: String!
    createdAt: DateTime!
    updatedAt: DateTime!

    files: [Files]
  }
  
  input FileDataInput {
    id: ID
    filename: String
  }
  input MessageInput {
    chat_id: ID
    message: String
    locale: String
    fileMessageList: [FileDataInput]
  }

  extend type Query {
    messages(chat_id: ID!, user_id: ID): [Message!]!
    message(id: ID!): Message
  }

  extend type Mutation {
    createMessage(input: MessageInput!): Message!
    updateMessage(id: ID!, input: MessageInput!): Message!
    deleteMessage(id: ID!): Boolean!
  }
`;
