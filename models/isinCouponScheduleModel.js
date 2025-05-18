// models/isinCouponScheduleModel.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const IsinCouponSchedule = sequelize.define('IsinCouponSchedule', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    isin: { type: DataTypes.STRING(20), allowNull: false },
    coupon_number: { type: DataTypes.INTEGER, allowNull: false },
    coupon_date: { type: DataTypes.DATEONLY, allowNull: false },
    coupon_amount: { type: DataTypes.DECIMAL(10, 4), allowNull: false },
    principal: { type: DataTypes.DECIMAL(10, 4), allowNull: false, defaultValue: 0 },
  }, {
    tableName: 'isin_coupon_schedule',
    timestamps: false
  });
  return IsinCouponSchedule;
};
