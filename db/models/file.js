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
      File.belongsTo(models.Message, { 
        foreignKey: 'message_id', 
        as: 'message' 
      });

      File.hasMany(models.Rag_chunk, {
        foreignKey: 'file_id',
        as: 'rag_chunk',
        onDelete: 'CASCADE',
        hooks: true, // ✅ จำเป็นถ้าใช้ paranoid
      });
    }
  }
  File.init({
    original_name: DataTypes.STRING,
    file_name: DataTypes.STRING,
    extension: DataTypes.STRING,
    mime_type: DataTypes.STRING,
    size_bytes: DataTypes.INTEGER,
    folder: DataTypes.STRING,
    stored_path: DataTypes.STRING,
    message_id: DataTypes.INTEGER
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'File',
    tableName: 'file'
  });
  return File;
};