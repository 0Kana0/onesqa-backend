'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Group extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      Group.hasMany(models.Group_ai, {
        foreignKey: 'group_id',
        as: 'group_ai',
        onDelete: 'CASCADE',
        hooks: true, // ✅ จำเป็นถ้าใช้ paranoid
      });

      Group.belongsTo(models.Ai, { 
        foreignKey: 'ai_id', 
        as: 'ai' 
      });
    }
  }
  Group.init({
    group_api_id: {
      type: DataTypes.INTEGER,
      allowNull: true,   // ✅ ให้เป็น null ได้
      // primaryKey: true,    // ❌ เอาออก
      // autoIncrement: false // จะมีหรือไม่มีก็ได้ ตามแบบที่ใช้
    },
    name: DataTypes.STRING,
    code: DataTypes.STRING,
    data_level: DataTypes.STRING,
    academy_level_id: DataTypes.STRING,
    status: DataTypes.BOOLEAN,
    ai_id: DataTypes.INTEGER,
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'Group',
    tableName: 'group'
  });
  return Group;
};