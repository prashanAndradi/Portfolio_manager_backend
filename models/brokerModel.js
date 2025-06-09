const { DataTypes } = require('sequelize');
const sequelize = require('../db'); // Adjust path to your sequelize instance

const Broker = sequelize.define('Broker', {
  broker_code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  broker_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  building_number: DataTypes.STRING(50),
  street_name: DataTypes.STRING(100),
  street_name2: DataTypes.STRING(100),
  city: DataTypes.STRING(100),
  province: DataTypes.STRING(100),
  zip_code: DataTypes.STRING(20),
  country: DataTypes.STRING(100),
  contact_name: DataTypes.STRING(100),
  contact_phone: DataTypes.STRING(30),
  contact_mobile: DataTypes.STRING(30),
  contact_fax: DataTypes.STRING(30),
  contact_email: DataTypes.STRING(100),
  broker_type: DataTypes.STRING(20), // MM, FX, Gsec, Stock, Other
  brokerage_method: DataTypes.STRING(20), // 'Cal Method' or 'Input %'
  brokerage_cal_method_id: DataTypes.INTEGER, // FK to cal_methods_master
  brokerage_input_percentage: DataTypes.DECIMAL(10, 4),
  brokerage_settlement_method_id: DataTypes.INTEGER, // FK to payment_method_master
  settlement_account_number: DataTypes.STRING(100),
}, {
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Broker;
