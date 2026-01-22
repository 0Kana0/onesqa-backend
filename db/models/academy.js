'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Academy extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      Academy.hasMany(models.SarHistory, {
        foreignKey: 'academy_id',
        as: 'sarhistory',
        onDelete: 'CASCADE',
        hooks: true, // ✅ จำเป็นถ้าใช้ paranoid
      });
    }
  }
  Academy.init({
    academy_api_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    name: DataTypes.STRING,
    code: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    academy_level_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    sar_file: {
      type: DataTypes.JSONB,      // ✅ ให้ตรงกับ DB
      allowNull: false,
      defaultValue: [],
    },
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'Academy',
    tableName: 'academy'
  });
  return Academy;
};