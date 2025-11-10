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

const chatgroupType = require("./types/chatgroup.type");
const chatgroupResolver = require("./resolvers/chatgroup.resolver");

const chatType = require("./types/chat.type");
const chatResolver = require("./resolvers/chat.resolver");

const messageType = require("./types/message.type");
const messageResolver = require("./resolvers/message.resolver");

const reportType = require("./types/report.type");
const reportResolver = require("./resolvers/report.resolver");

const fileType = require("./types/file.type");
const fileResolver = require("./resolvers/file.resolver");

const typeDefs = [
  baseType, 
  aiType, 
  authType,
  roleType,
  userType,
  logType,
  settingType,
  notificationType,
  userStatusType,
  chatgroupType,
  chatType,
  messageType,
  reportType,
  fileType
];
const resolvers = [
  aiResolver, 
  authResolver,
  roleResolver,
  userResolver,
  logResolver,
  settingResolver,
  notificationResolver,
  userStatusResolver,
  chatgroupResolver,
  chatResolver,
  messageResolver,
  reportResolver,
  fileResolver
];

const schema = makeExecutableSchema({ typeDefs, resolvers });

module.exports = { schema };
