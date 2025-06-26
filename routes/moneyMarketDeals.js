const express = require('express');
const router = express.Router();

// Import your DB connection (adjust path as needed)
const pool = require('../db');

// POST /api/money-market-deals - Save a new deal
router.post('/', async (req, res) => {
  const deal = req.body;
  try {
    // Format date to YYYYMMDD
    const tradeDate = new Date(deal.tradeDate);
    const yyyy = tradeDate.getFullYear();
    const mm = String(tradeDate.getMonth() + 1).padStart(2, '0');
    const dd = String(tradeDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}${mm}${dd}`;
    const productCode = deal.productType;

    // Get max sequence for this date and product
    const [rows] = await pool.query(
      'SELECT deal_number FROM money_market_deals WHERE trade_date = ? AND product_type = ? ORDER BY deal_number DESC LIMIT 1',
      [deal.tradeDate, productCode]
    );
    let nextSeq = 1;
    if (rows.length > 0) {
      // Extract the last 4 digits from deal_number
      const lastDealNumber = rows[0].deal_number;
      const lastSeq = parseInt(lastDealNumber.slice(-4), 10);
      nextSeq = lastSeq + 1;
    }
    const seqStr = String(nextSeq).padStart(4, '0');
    const dealNumber = `${dateStr}${productCode}${seqStr}`;

    const [result] = await pool.query(
      `INSERT INTO money_market_deals
      (deal_number, trade_date, value_date, maturity_date, counterparty_id, product_type, currency, principal_amount, interest_rate, tenor, interest_amount, maturity_value, settlement_mode, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dealNumber, deal.tradeDate, deal.valueDate, deal.maturityDate, deal.counterpartyId, deal.productType,
        deal.currency, deal.principalAmount, deal.interestRate, deal.tenor, deal.interestAmount, deal.maturityValue,
        deal.settlementMode, deal.remarks
      ]
    );
    res.status(201).json({ success: true, message: 'Deal saved', id: result.insertId, dealNumber });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to save deal', error: err.message });
  }
});

// GET /api/money-market-deals - List all deals (optional)
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM money_market_deals ORDER BY trade_date DESC');
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch deals', error: err.message });
  }
});

module.exports = router;
