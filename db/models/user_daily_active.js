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
      });
    }
  }
  User_daily_active.init(
    {
      user_id: { type: DataTypes.INTEGER, allowNull: true },
      active_type: {
        type: DataTypes.ENUM('LOGIN', 'ACTIVE'),
        allowNull: false,
        defaultValue: 'LOGIN',
      },
      active_date: { type: DataTypes.DATEONLY, allowNull: false },
    },
    {
      sequelize,
      freezeTableName: true,
      timestamps: true,
      modelName: 'User_daily_active',
      tableName: 'user_daily_active',
      indexes: [
        {
          unique: true,
          fields: ['user_id', 'active_type', 'active_date'],
          name: 'uq_user_daily_active_user_type_date',
        },
      ],
    }
  );

  return User_daily_active;
};