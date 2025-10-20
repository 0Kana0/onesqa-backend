"use strict";
const {
  Model
} = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      User.hasMany(models.RefreshToken, {
        foreignKey: 'user_id',
        as: 'refreshtoken',
        onDelete: 'CASCADE',
        hooks: true, // ✅ จำเป็นถ้าใช้ paranoid
      });
      User.hasMany(models.User_role, {
        foreignKey: 'user_id',
        as: 'user_role',
        onDelete: 'CASCADE',
        hooks: true, // ✅ จำเป็นถ้าใช้ paranoid
      });
      User.hasMany(models.User_ai, {
        foreignKey: 'user_id',
        as: 'user_ai',
        onDelete: 'CASCADE',
        hooks: true, // ✅ จำเป็นถ้าใช้ paranoid
      });
      User.hasMany(models.Notification, {
        foreignKey: 'user_id',
        as: 'notification',
        onDelete: 'CASCADE',
        hooks: true, // ✅ จำเป็นถ้าใช้ paranoid
      });
    }
  }
  User.init({
    firstname: DataTypes.STRING,
    lastname: DataTypes.STRING,
    username: DataTypes.STRING,
    password: DataTypes.STRING,
    phone: DataTypes.STRING,
    email: DataTypes.STRING,
    login_type: {
      type: DataTypes.ENUM('NORMAL', 'INSPEC'),
      allowNull: false,
      defaultValue: 'NORMAL',
    },
    position: DataTypes.STRING,
    group_name: DataTypes.STRING,
    ai_access: DataTypes.BOOLEAN,
    color_mode: {
      type: DataTypes.ENUM('LIGHT', 'DARK'),
      allowNull: false,
      defaultValue: 'LIGHT',
    },
    loginAt: DataTypes.DATE,
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'User',
    tableName: 'user'
  });
  return User;
};