module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้

  enum localeMode {
    th
    en
  }

  type Prompt {
    id: ID!
    prompt_title: String!
    prompt_detail: String!
    locale: localeMode!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  input PromptInput {
    prompt_title: String
    prompt_detail: String
    locale: localeMode
  }

  extend type Query {
    prompts: [Prompt!]!
    prompt(id: ID!): Prompt
  }

  extend type Mutation {
    createPrompt(input: PromptInput!): Prompt!
    updatePrompt(id: ID!, input: PromptInput!): Prompt!
    deletePrompt(id: ID!): Boolean!
  }
`;
