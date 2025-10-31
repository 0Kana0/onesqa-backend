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
    }
  }
  Ai.init({
    model_name: DataTypes.STRING,
    model_use_name: DataTypes.STRING,
    model_type: DataTypes.STRING,
    token_count: DataTypes.INTEGER,
    token_all: DataTypes.INTEGER,
    activity: DataTypes.BOOLEAN
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'Ai',
    tableName: 'ai'
  });
  return Ai;
};