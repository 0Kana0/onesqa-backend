'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class User_login_history extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      User_login_history.belongsTo(models.User, {
        foreignKey: 'user_id',
        as: 'user',
      });
    }
  }
  User_login_history.init({
    user_id: DataTypes.INTEGER,
    event_type: {
      type: DataTypes.ENUM('LOGIN_SUCCESS', 'LOGOUT'),
      allowNull: false,
      defaultValue: 'LOGIN_SUCCESS',
    },
    user_agent: DataTypes.STRING
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'User_login_history',
    tableName: 'user_login_history'
  });
  return User_login_history;
};