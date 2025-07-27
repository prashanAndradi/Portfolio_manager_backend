const express = require('express');
const router = express.Router();
const generateMoneyMarketVoucherPDF = require('../voucherTemplates/moneyMarketVoucherTemplate');
const pool = require('../db');

// Example company info and tag (customize as needed)
const companyInfo = {
  name: 'ALCYONE TREASURY SOLUTIONS (PVT) LTD',
  year: '2025',
  tag: 'ALCYONE TREASURY SOLUTIONS (PVT) LTD', // Provided tag as header
  footer: '2025 All Rights Reserved'
};

router.get('/:deal_number/voucher', async (req, res) => {
  const { deal_number } = req.params;
  try {
    // Fetch deal details
    const [dealRows] = await pool.query('SELECT * FROM money_market_deals WHERE deal_number = ?', [deal_number]);
    if (dealRows.length === 0) return res.status(404).send('Deal not found');
    const deal = dealRows[0];

    // Fetch ledger entries
    const [ledgerRows] = await pool.query(
      `SELECT le.*, coa.name as account_name FROM ledger_entries le LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id WHERE le.deal_number = ?`,
      [deal_number]
    );

    // Fetch approval history (example, customize if you have a separate table)
    // Here, we just use the current approval info for demo
    const approvalHistory = [];
    if (deal.authorized_by) {
      approvalHistory.push({
        level: deal.current_approval_level,
        user: deal.authorized_by,
        time: deal.authorized_at
      });
    }
    // Add more historical approvals if tracked

    // Fetch and populate counterparty name
    let counterpartyName = '';
    if (deal.counterparty_id) {
      const [indRows] = await pool.query('SELECT short_name FROM counterparty_master_individual WHERE id = ?', [deal.counterparty_id]);
      if (indRows.length > 0) {
        counterpartyName = indRows[0].short_name;
      } else {
        const [jointRows] = await pool.query('SELECT short_name FROM counterparty_master_joint WHERE id = ?', [deal.counterparty_id]);
        if (jointRows.length > 0) counterpartyName = jointRows[0].short_name;
      }
    }
    deal.counterparty_name = counterpartyName;

    // Fetch and populate settlement bank/account
    let settlementBank = '', settlementAccount = '';
    if (deal.settlement_mode) {
      const [settleRows] = await pool.query('SELECT bank_name, bank_account_number FROM settlement_accounts WHERE bank_payment_code = ?', [deal.settlement_mode]);
      if (settleRows.length > 0) {
        settlementBank = settleRows[0].bank_name || '';
        settlementAccount = settleRows[0].bank_account_number || '';
      }
    }
    deal.settlement_bank = settlementBank;
    deal.settlement_account = settlementAccount;

    await generateMoneyMarketVoucherPDF(res, deal, ledgerRows, companyInfo, approvalHistory);
  } catch (err) {
    console.error('Voucher PDF error:', err);
    res.status(500).send('Failed to generate voucher PDF');
  }
});

module.exports = router;
