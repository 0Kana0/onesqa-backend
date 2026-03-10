'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Ai_backup extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Ai_backup.init({
    model_name: DataTypes.STRING,
    model_use_name: DataTypes.STRING,
    model_type: DataTypes.STRING,
    message_type: {
      type: DataTypes.ENUM('TEXT', 'IMAGE', 'VIDEO', "DOC"),
      allowNull: false,
    },
    token_count: DataTypes.INTEGER,
    token_all: DataTypes.INTEGER,
    activity: DataTypes.BOOLEAN,
    is_notification: DataTypes.BOOLEAN,
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'Ai_backup',
    tableName: 'ai_backup'
  });
  return Ai_backup;
};