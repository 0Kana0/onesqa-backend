'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class User_token extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      User_token.belongsTo(models.Ai, { 
        foreignKey: 'ai_id', 
        as: 'ai' 
      });
      User_token.belongsTo(models.User, {
        foreignKey: 'user_id',
        as: 'user',
        onDelete: 'SET NULL',   // ✅ เวลา user ถูกลบ user_id = null
        hooks: true,
      });
    }
  }
  User_token.init({
    used_date: DataTypes.DATEONLY,   // ✅ เก็บเฉพาะวัน เช่น "2025-12-14"
    input_token: DataTypes.INTEGER,
    output_token: DataTypes.INTEGER,
    total_token: DataTypes.INTEGER,
    user_id: DataTypes.INTEGER,
    ai_id: DataTypes.INTEGER,
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'User_token',
    tableName: 'user_token'
  });
  return User_token;
};