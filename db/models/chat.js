'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Chat extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      Chat.belongsTo(models.Chatgroup, { 
        foreignKey: 'chatgroup_id', 
        as: 'chatgroup',
        onDelete: 'SET NULL',   // ✅ เวลา user ถูกลบ user_id = null
        hooks: true,
      });
      Chat.belongsTo(models.User, { 
        foreignKey: 'user_id', 
        as: 'user' 
      });
      Chat.belongsTo(models.Ai, { 
        foreignKey: 'ai_id', 
        as: 'ai' 
      });

      Chat.hasMany(models.Message, {
        foreignKey: 'chat_id',
        as: 'message',
        onDelete: 'CASCADE',
        hooks: true, // ✅ จำเป็นถ้าใช้ paranoid
      });
      Chat.hasMany(models.Rag_chunk, {
        foreignKey: 'chat_id',
        as: 'rag_chunk',
        onDelete: 'CASCADE',
        hooks: true, // ✅ จำเป็นถ้าใช้ paranoid
      });
    }
  }
  Chat.init({
    chat_name: DataTypes.STRING,
    chatgroup_id: DataTypes.INTEGER,
    user_id: DataTypes.INTEGER,
    ai_id: DataTypes.INTEGER
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'Chat',
    tableName: 'chat'
  });
  return Chat;
};