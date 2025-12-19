'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Group_ai extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      Group_ai.belongsTo(models.Group, { 
        foreignKey: 'group_id', 
        as: 'group' 
      });
      Group_ai.belongsTo(models.Ai, { 
        foreignKey: 'ai_id', 
        as: 'ai' 
      });
    }
  }
  Group_ai.init({
    group_id: DataTypes.INTEGER,
    ai_id: DataTypes.INTEGER,
    init_token: DataTypes.INTEGER
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'Group_ai',
    tableName: 'group_ai'
  });
  return Group_ai;
};