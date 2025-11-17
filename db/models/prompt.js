'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Prompt extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Prompt.init({
    prompt_title: DataTypes.STRING,
    prompt_detail: DataTypes.TEXT,
    locale: {
      type: DataTypes.ENUM('th', 'en'),
      allowNull: false,
      defaultValue: 'th',
    },
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'Prompt',
    tableName: 'prompt'
  });
  return Prompt;
};