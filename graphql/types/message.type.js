module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้

  enum MessageType {
    TEXT
    IMAGE
    VIDEO
    DOC
  }

  type Files {
    id: ID
    file_name: String
    original_name: String
    stored_path: String
  }
  type Message {
    id: ID!
    role: String!
    message_type: MessageType!
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
    message_type: MessageType
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
    createMessageImage(input: MessageInput!): Message!
    createMessageVideo(input: MessageInput!): Message!
    createMessageDoc(input: MessageInput!): Message!
    updateMessage(id: ID!, input: MessageInput!): Message!
    deleteMessage(id: ID!): Boolean!
  }
`;
