const db = require('../db');

const Gsec = {
  create: (data, callback) => {
    const sql = `INSERT INTO gsec (
      trade_type, transaction_type, counterparty, deal_number, isin, face_value, value_date, next_coupon_date, last_coupon_date, number_of_days_interest_accrued, number_of_days_for_coupon_period, accrued_interest, coupon_interest, clean_price, dirty_price, accrued_interest_calculation, accrued_interest_six_decimals, accrued_interest_for_100, settlement_amount, settlement_mode, issue_date, maturity_date, coupon_dates, yield
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [
      data.tradeType,
      data.transactionType,
      data.counterparty,
      data.dealNumber,
      data.isin,
      data.faceValue,
      data.valueDate,
      data.nextCouponDate,
      data.lastCouponDate,
      data.numberOfDaysInterestAccrued,
      data.numberOfDaysForCouponPeriod,
      data.accruedInterest,
      data.couponInterest,
      data.cleanPrice,
      data.dirtyPrice,
      data.accruedInterestCalculation,
      data.accruedInterestSixDecimals,
      data.accruedInterestFor100,
      data.settlementAmount,
      data.settlementMode,
      data.issueDate,
      data.maturityDate,
      data.couponDates,
      data.yield
    ];
    db.query(sql, values, callback);
  }
};

module.exports = Gsec;
