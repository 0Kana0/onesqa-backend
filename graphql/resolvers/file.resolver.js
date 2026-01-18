// graphql/uploadResolvers.js
const FileController = require('../../controllers/file.controller');
const { requireAuth, checkUserInDB } = require('../../utils/authGuard');
const { GraphQLUpload } = require('graphql-upload');

module.exports = {
  Upload: GraphQLUpload,
  Mutation: {
    singleUpload: async (_, { file }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await FileController.saveUpload(file)
    },
    multipleUpload: async (_, { files, ai_id, user_id }, ctx) => {
      requireAuth(ctx); // ต้องล็อกอินก่อน
      await checkUserInDB(ctx);
      return await Promise.all(
        files.map(file => FileController.saveUpload(file, ai_id, user_id, ctx))
      );
    }
  },
};
