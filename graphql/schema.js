const { makeExecutableSchema } = require("@graphql-tools/schema");

// root types ว่าง ๆ สำหรับ extend
const baseType = `
  type Query
  type Mutation
`;

// โหลดต่อโมดูล
const aiType = require("./types/ai.type");
const aiResolver = require("./resolvers/ai.resolver");

const roleType = require("./types/role.type");
const roleResolver = require("./resolvers/role.resolver");

const authType = require("./types/auth.type");
const authResolver = require("./resolvers/auth.resolver");

const userType = require("./types/user.type");
const userResolver = require("./resolvers/user.resolver");

const typeDefs = [
  baseType, 
  aiType, 
  authType,
  roleType,
  userType
];
const resolvers = [
  aiResolver, 
  authResolver,
  roleResolver,
  userResolver
];

const schema = makeExecutableSchema({ typeDefs, resolvers });

module.exports = { schema };
