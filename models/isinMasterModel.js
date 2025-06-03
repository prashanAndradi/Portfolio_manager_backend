const db = require('../config/db');

const IsinMaster = {
  create: (data, callback) => {
    const sql = `INSERT INTO isin_master (isin_issuer, isin_number, issue_date, maturity_date, coupon_rate, series, coupon_date_1, coupon_date_2, day_basis, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    db.query(sql, [
      data.isin_issuer,
      data.isin_number,
      data.issue_date,
      data.maturity_date,
      data.coupon_rate,
      data.series,
      data.coupon_date_1,
      data.coupon_date_2,
      data.day_basis,
      data.currency
    ], callback);
  },
  getAll: async () => {
    const [results] = await db.query('SELECT * FROM isin_master');
    return results;
  },
  searchByIsin: async (query) => {
    const sql = 'SELECT isin_number FROM isin_master WHERE isin_number LIKE ? LIMIT 10';
    const [results] = await db.query(sql, [`%${query}%`]);
    return results;
  },
  getById: async (id) => {
    const [results] = await db.query('SELECT * FROM isin_master WHERE id = ?', [id]);
    return results[0];
  },

};

module.exports = IsinMaster;
