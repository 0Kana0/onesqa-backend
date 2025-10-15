'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Log extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Log.init({
    edit_name: DataTypes.STRING,
    log_type: {
      type: DataTypes.ENUM('PROMPT', 'ALERT', 'MODEL', 'PERSONAL', 'GROUP'),
      allowNull: false,
      //defaultValue: 'NORMAL',
    },
    old_data: DataTypes.STRING,
    new_data: DataTypes.STRING,
    old_status: DataTypes.BOOLEAN,
    new_status: DataTypes.BOOLEAN
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'Log',
    tableName: 'log'
  });
  return Log;
};