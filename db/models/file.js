'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class File extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  File.init({
    original_name: DataTypes.STRING,
    file_name: DataTypes.STRING,
    extension: DataTypes.STRING,
    mime_type: DataTypes.STRING,
    size_bytes: DataTypes.INTEGER,
    folder: DataTypes.STRING,
    stored_path: DataTypes.STRING
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'File',
    tableName: 'file'
  });
  return File;
};