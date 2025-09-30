'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class User_role extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      User_role.belongsTo(models.User, { 
        foreignKey: 'user_id', 
        as: 'user' 
      });
      User_role.belongsTo(models.Role, { 
        foreignKey: 'role_id', 
        as: 'role' 
      });
    }
  }
  User_role.init({
    user_id: DataTypes.INTEGER,
    role_id: DataTypes.INTEGER,
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'User_role',
    tableName: 'user_role'
  });
  return User_role;
};