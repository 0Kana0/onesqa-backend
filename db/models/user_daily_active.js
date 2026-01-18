'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class User_daily_active extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      User_daily_active.belongsTo(models.User, {
        foreignKey: 'user_id',
        as: 'user',
        onDelete: 'SET NULL',   // ✅ เวลา user ถูกลบ user_id = null
        hooks: true,
      });
    }
  }
  User_daily_active.init({
    user_id: DataTypes.INTEGER,
    active_type: {
      type: DataTypes.ENUM('LOGIN', 'ACTIVE'),
      allowNull: false,
      defaultValue: 'LOGIN',
    },
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'User_daily_active',
    tableName: 'user_daily_active'
  });
  return User_daily_active;
};