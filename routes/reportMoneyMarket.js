const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/reports/money-market
router.get('/', async (req, res) => {
  try {
    const sql = `
      SELECT
        mmd.deal_number AS dealId,
        mmd.trade_date,
        mmd.value_date,
        mmd.maturity_date,
        mmd.tenor,
        mmd.product_type,
        cp.name AS counterparty,
        mmd.currency,
        mmd.principal_amount,
        mmd.interest_rate,
        mmd.maturity_value AS maturity_amount,
        (mmd.principal_amount + mmd.maturity_value) AS total_receivable,
        mmd.limit_utilization,
        u.full_name AS authorized_user
      FROM money_market_deals mmd
      LEFT JOIN counterparty_master cp ON mmd.counterparty_id = cp.id
      LEFT JOIN users u ON mmd.authorized_user_id = u.id
      ORDER BY mmd.trade_date DESC
    `;
    const [rows] = await db.query(sql);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching money market report:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch report' });
  }
});

module.exports = router;
