'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Message extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      Message.belongsTo(models.Chat, { 
        foreignKey: 'chat_id', 
        as: 'chat' 
      });
    }
  }
  Message.init({
    role: DataTypes.STRING,
    text: DataTypes.TEXT,
    file: DataTypes.JSON,
    chat_id: DataTypes.INTEGER
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'Message',
    tableName: 'message'
  });
  return Message;
};