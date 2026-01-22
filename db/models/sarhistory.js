'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class SarHistory extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      SarHistory.belongsTo(models.Academy, { 
        foreignKey: 'academy_id', 
        as: 'academy' 
      });
    }
  }
  SarHistory.init({
    delete_name: DataTypes.STRING,
    sar_file: DataTypes.STRING,
    academy_id: DataTypes.INTEGER,
  }, {
    sequelize,
    freezeTableName: true,
    timestamps: true, // ต้องเปิด timestamps ด้วย
    modelName: 'SarHistory',
    tableName: 'sarhistory'
  });
  return SarHistory;
};