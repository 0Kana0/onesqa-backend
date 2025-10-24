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

const logType = require("./types/log.type");
const logResolver = require("./resolvers/log.resolver");

const settingType = require("./types/setting.type");
const settingResolver = require("./resolvers/setting.resolver");

const notificationType = require("./types/notification.type");
const notificationResolver = require("./resolvers/notification.resolver");

const userStatusType = require("./types/userStatus.type");
const userStatusResolver = require("./resolvers/userStatus.resolver");

const typeDefs = [
  baseType, 
  aiType, 
  authType,
  roleType,
  userType,
  logType,
  settingType,
  notificationType,
  userStatusType
];
const resolvers = [
  aiResolver, 
  authResolver,
  roleResolver,
  userResolver,
  logResolver,
  settingResolver,
  notificationResolver,
  userStatusResolver
];

const schema = makeExecutableSchema({ typeDefs, resolvers });

module.exports = { schema };
