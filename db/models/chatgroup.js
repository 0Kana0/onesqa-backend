'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Chatgroup extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      Chatgroup.belongsTo(models.User, { 
        foreignKey: 'user_id', 
        as: 'user' 
      });

      Chatgroup.hasMany(models.Chat, {
        foreignKey: 'chatgroup_id',
        as: 'chat',
        onDelete: 'CASCADE',
        hooks: true, // ✅ จำเป็นถ้าใช้ paranoid
      });
    }
  }
  Chatgroup.init({
    chatgroup_name: DataTypes.STRING,
    user_id: DataTypes.INTEGER
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'Chatgroup',
    tableName: 'chatgroup'
  });
  return Chatgroup;
};