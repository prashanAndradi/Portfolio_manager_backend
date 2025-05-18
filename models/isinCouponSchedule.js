const db = require('../db');

const IsinCouponSchedule = {
  bulkInsert: (records, callback) => {
    if (!records.length) return callback(null, []);
    const sql = `INSERT INTO isin_coupon_schedule (isin, coupon_number, coupon_date, coupon_amount, principal) VALUES ?`;
    const values = records.map(r => [r.isin, r.coupon_number, r.coupon_date, r.coupon_amount, r.principal]);
    db.query(sql, [values], callback);
  }
};

module.exports = IsinCouponSchedule;
