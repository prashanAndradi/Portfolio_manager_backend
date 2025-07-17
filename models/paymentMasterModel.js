const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PaymentMaster = sequelize.define('PaymentMaster', {
  paymentCode: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  bankName: DataTypes.STRING,
  branch: DataTypes.STRING,
  accountNumber: DataTypes.STRING,
}, {
  tableName: 'payment_master',
  timestamps: false,
});

module.exports = PaymentMaster;
