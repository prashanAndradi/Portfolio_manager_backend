const db = require('../config/db');

const LimitSetup = {
  getAllCounterparties: async () => {
    const sql = `
      SELECT id, short_name AS name, 'individual' AS type FROM counterparty_master_individual
      UNION ALL
      SELECT id, short_name AS name, 'joint' AS type FROM counterparty_master_joint
      ORDER BY name
    `;
    const [rows] = await db.query(sql);
    return rows;
  },
  create: async (data) => {
    const sql = `INSERT INTO counterparty_limits (
      counterparty_id, counterparty_type, overall_exposure_limit, currency_limit,
      product_money_market_limit, product_fx_limit, product_derivative_limit, product_repo_limit,
      product_reverse_repo_limit, product_gsec_limit, product_sell_and_buy_back_limit, product_buy_and_sell_back_limit,
      tenor_limit, settlement_risk_limit, country_limit, group_limit, intraday_limit
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [
      data.counterparty_id,
      data.counterparty_type,
      data.overall_exposure_limit,
      data.currency_limit,
      data.product_money_market_limit,
      data.product_fx_limit,
      data.product_derivative_limit,
      data.product_repo_limit,
      data.product_reverse_repo_limit,
      data.product_gsec_limit,
      data.product_sell_and_buy_back_limit,
      data.product_buy_and_sell_back_limit,
      data.tenor_limit,
      data.settlement_risk_limit,
      data.country_limit,
      data.group_limit,
      data.intraday_limit
    ];
    const [result] = await db.query(sql, values);
    return result;
  }
};

module.exports = LimitSetup;
