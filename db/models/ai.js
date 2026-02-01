'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Ai extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      Ai.hasMany(models.User_ai, {
        foreignKey: 'ai_id',
        as: 'user_ai',
        onDelete: 'CASCADE',
        hooks: true, // ✅ จำเป็นถ้าใช้ paranoid
      });
      Ai.hasMany(models.Chat, {
        foreignKey: 'ai_id',
        as: 'chat',
        onDelete: 'CASCADE',
        hooks: true, // ✅ จำเป็นถ้าใช้ paranoid
      });
      Ai.hasMany(models.Group, {
        foreignKey: 'ai_id',
        as: 'group',
        onDelete: 'CASCADE',
        hooks: true, // ✅ จำเป็นถ้าใช้ paranoid
      });
      Ai.hasMany(models.Group_ai, {
        foreignKey: 'ai_id',
        as: 'group_ai',
        onDelete: 'CASCADE',
        hooks: true, // ✅ จำเป็นถ้าใช้ paranoid
      });
    }
  }
  Ai.init({
    model_name: DataTypes.STRING,
    model_use_name: DataTypes.STRING,
    model_type: DataTypes.STRING,
    message_type: {
      type: DataTypes.ENUM('TEXT', 'IMAGE', 'VIDEO', "DOC"),
      allowNull: false,
    },
    token_count: DataTypes.INTEGER,
    token_all: DataTypes.INTEGER,
    activity: DataTypes.BOOLEAN,
    is_notification: DataTypes.BOOLEAN,
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'Ai',
    tableName: 'ai'
  });
  return Ai;
};