'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Setting extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Setting.init({
    setting_name_th: DataTypes.STRING,
    setting_name_en: DataTypes.STRING,
    setting_detail_th: DataTypes.STRING,
    setting_detail_en: DataTypes.STRING,
    activity: DataTypes.BOOLEAN
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'Setting',
    tableName: 'setting'
  });
  return Setting;
};