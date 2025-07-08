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
      (deal_number, trade_date, value_date, maturity_date, counterparty_id, product_type, currency, principal_amount, interest_rate, tenor, interest_amount, maturity_value, settlement_mode, remarks, deal_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dealNumber, deal.tradeDate, deal.valueDate, deal.maturityDate, deal.counterpartyId, deal.productType,
        deal.currency, deal.principalAmount, deal.interestRate, deal.tenor, deal.interestAmount, deal.maturityValue,
        deal.settlementMode, deal.remarks, deal.dealType || null
      ]
    );
    res.status(201).json({ success: true, message: 'Deal saved', id: result.insertId, dealNumber });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to save deal', error: err.message });
  }
});

// GET /api/money-market-deals - List all deals, or limit if ?limit=N
router.get('/', async (req, res) => {
  try {
    let sql = 'SELECT * FROM money_market_deals ORDER BY trade_date DESC, id DESC';
    const values = [];
    if (req.query.limit) {
      sql += ' LIMIT ?';
      values.push(Number(req.query.limit));
    }
    const [rows] = await pool.query(sql, values);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch deals', error: err.message });
  }
});

// PUT /api/money-market-deals/:deal_number - Update status/authorization
router.put('/:deal_number', async (req, res) => {
  const dealNumber = req.params.deal_number;
  const {
    status,
    current_approval_level,
    comment,
    authorized_by,
    authorized_at
  } = req.body;

  // Build dynamic update query
  const fields = [];
  const values = [];
  if (status !== undefined) {
    fields.push('status = ?');
    values.push(status);
  }
  if (current_approval_level !== undefined) {
    fields.push('current_approval_level = ?');
    values.push(current_approval_level);
  }
  if (comment !== undefined) {
    fields.push('comment = ?');
    values.push(comment);
  }
  if (authorized_by !== undefined) {
    fields.push('authorized_by = ?');
    values.push(authorized_by);
  }
  if (authorized_at !== undefined) {
    fields.push('authorized_at = ?');
    values.push(authorized_at);
  }
  if (fields.length === 0) {
    return res.status(400).json({ success: false, message: 'No fields to update' });
  }
  try {
    const [result] = await pool.query(
      `UPDATE money_market_deals SET ${fields.join(', ')} WHERE deal_number = ?`,
      [...values, dealNumber]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Deal not found' });
    }
    // Return the updated deal
    const [rows] = await pool.query('SELECT * FROM money_market_deals WHERE deal_number = ?', [dealNumber]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update deal', error: err.message });
  }
});

module.exports = router;
