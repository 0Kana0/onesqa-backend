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

      Message.hasMany(models.File, {
        foreignKey: 'message_id',
        as: 'files',
        onDelete: 'CASCADE',
        hooks: true, // ✅ จำเป็นถ้าใช้ paranoid
      });
    }
  }
  Message.init({
    role: DataTypes.STRING,
    text: DataTypes.TEXT,
    file: DataTypes.JSON,
    input_token: DataTypes.INTEGER,
    output_token: DataTypes.INTEGER,
    total_token: DataTypes.INTEGER,
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