const db = require('../db');

// Get all distinct bank payment codes from settlement_accounts
exports.getBankPaymentCodes = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT DISTINCT bank_payment_code FROM settlement_accounts WHERE bank_payment_code IS NOT NULL AND bank_payment_code != ""');
    res.json({ success: true, data: rows.map(r => r.bank_payment_code) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Get bank details by bank_payment_code
exports.getBankDetailsByPaymentCode = async (req, res) => {
  try {
    const code = req.params.code;
    const [rows] = await db.query(
      'SELECT bank_name, bank_branch, bank_account_number FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
      [code]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No bank details found for this code' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
