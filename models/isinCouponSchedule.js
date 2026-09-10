const db = require('../db');

// `../db` is a mysql2/**promise** pool, so pool.query() returns a Promise and
// silently ignores any callback passed as a third argument. These methods keep
// their callback signatures (many callers rely on them) but must drive them
// from the promise - passing a callback straight to db.query means it is never
// invoked, the response is never sent, and the request hangs until the caller
// or API Gateway times out.
const IsinCouponSchedule = {
  bulkInsert: (records, callback) => {
    if (!records.length) return callback(null, []);
    const sql = `INSERT INTO isin_coupon_schedule (isin, coupon_number, coupon_date, coupon_amount, principal) VALUES ?`;
    const values = records.map(r => [r.isin, r.coupon_number, r.coupon_date, r.coupon_amount, r.principal]);
    db.query(sql, [values])
      .then(([result]) => callback(null, result))
      .catch(callback);
  },

  /**
   * Get the previous and next coupon dates for a given ISIN and value date.
   * @param {string} isin - The ISIN number.
   * @param {string} valueDate - The value date in YYYY-MM-DD format.
   * @param {function} callback - Callback with (err, { previousCouponDate, nextCouponDate })
   */
  getPrevAndNextCouponDates: (isin, valueDate, callback) => {
    const sql = `SELECT coupon_date FROM isin_coupon_schedule WHERE isin COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci ORDER BY coupon_date ASC`;
    db.query(sql, [isin])
      .then(([results]) => {
        if (!results || results.length === 0) {
          return callback(null, { previousCouponDate: null, nextCouponDate: null });
        }
        let previousCouponDate = null;
        let nextCouponDate = null;
        const valueDateObj = new Date(valueDate);
        for (let i = 0; i < results.length; i++) {
          const dateStr = results[i].coupon_date;
          const dateObj = new Date(dateStr);
          if (dateObj <= valueDateObj) previousCouponDate = dateStr;
          if (dateObj > valueDateObj && nextCouponDate === null) {
            nextCouponDate = dateStr;
            break;
          }
        }
        // If valueDate is before the first coupon date
        if (!previousCouponDate) {
          previousCouponDate = results[0].coupon_date;
          nextCouponDate = results[1] ? results[1].coupon_date : null;
        }
        // If valueDate is after the last coupon date
        if (!nextCouponDate) {
          previousCouponDate = results[results.length - 2] ? results[results.length - 2].coupon_date : results[results.length - 1].coupon_date;
          nextCouponDate = results[results.length - 1].coupon_date;
        }
        callback(null, { previousCouponDate, nextCouponDate });
      })
      .catch(callback);
  },
  /**
   * Get all coupon months/days (MM/DD) for a given ISIN, sorted.
   * @param {string} isin - The ISIN number.
   * @param {function} callback - Callback with (err, [ '04/15', '10/15', ... ])
   */
  getCouponMonths: (isin, callback) => {
    const sql = `SELECT DISTINCT coupon_date FROM isin_coupon_schedule WHERE isin COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci ORDER BY coupon_date ASC`;
    db.query(sql, [isin])
      .then(([results]) => {
        if (!results || results.length === 0) return callback(null, []);
        // Extract MM/DD from coupon_date
        const months = results.map(r => {
          const d = new Date(r.coupon_date);
          if (isNaN(d.getTime())) return null;
          return (d.getMonth() + 1).toString().padStart(2, '0') + '/' + d.getDate().toString().padStart(2, '0');
        }).filter(Boolean);
        // Remove duplicates and sort
        const unique = Array.from(new Set(months));
        unique.sort();
        callback(null, unique);
      })
      .catch(callback);
  },

};

module.exports = IsinCouponSchedule;
