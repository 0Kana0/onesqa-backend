// graphql/uploadResolvers.js
const FileController = require('../../controllers/file.controller');
const { requireAuth } = require('../../utils/authGuard');
const { GraphQLUpload } = require('graphql-upload');

module.exports = {
  Upload: GraphQLUpload,
  Mutation: {
    singleUpload: async (_, { file }) => {
      //requireAuth(ctx); // ต้องล็อกอินก่อน
      return await FileController.saveUpload(file)
    },
    multipleUpload: async (_, { files, ai_id, user_id }) => {
      return await Promise.all(
        files.map(file => FileController.saveUpload(file, ai_id, user_id))
      );
    }
  },
};
