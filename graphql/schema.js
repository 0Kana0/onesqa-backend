const { makeExecutableSchema } = require('@graphql-tools/schema');

// root types ว่าง ๆ สำหรับ extend
const baseType = `
  type Query
  type Mutation
`;

// โหลดต่อโมดูล
const aiType = require('./types/ai.type');
const aiResolver = require('./resolvers/ai.resolver');

const typeDefs = [baseType, aiType];
const resolvers = [aiResolver];

const schema = makeExecutableSchema({ typeDefs, resolvers });

module.exports = { schema };
