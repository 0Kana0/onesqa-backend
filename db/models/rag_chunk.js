'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Rag_chunk extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      Rag_chunk.belongsTo(models.Chat, { 
        foreignKey: 'chat_id', 
        as: 'chat' 
      });
      Rag_chunk.belongsTo(models.File, { 
        foreignKey: 'file_id', 
        as: 'file' 
      });
    }
  }
  
  Rag_chunk.init({
    chat_id: DataTypes.INTEGER,
    file_id: DataTypes.INTEGER,
    file_name: DataTypes.STRING,
    file_ext: DataTypes.STRING,
    chunk_index: DataTypes.INTEGER,
    content: DataTypes.TEXT("long"),
    embedding_json: DataTypes.TEXT("long"),
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'Rag_chunk',
    tableName: 'rag_chunk'
  });
  return Rag_chunk;
};