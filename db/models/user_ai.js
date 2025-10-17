'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class User_ai extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      User_ai.belongsTo(models.User, { 
        foreignKey: 'user_id', 
        as: 'user' 
      });
      User_ai.belongsTo(models.Ai, { 
        foreignKey: 'ai_id', 
        as: 'ai' 
      });
    }
  }
  User_ai.init({
    user_id: DataTypes.INTEGER,
    ai_id: DataTypes.INTEGER,
    token_count: DataTypes.INTEGER,
    token_all: DataTypes.INTEGER,
    activity: DataTypes.BOOLEAN
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'User_ai',
    tableName: 'user_ai'
  });
  return User_ai;
};