/**
 * T-Bill GL account mappings for Buy/Sell/Maturity ledger postings + EOD daily accrual.
 * Mirrors 20260609-add-gsec-buy-sell-ledger-mappings.js: only inserts/updates
 * account_mappings rows, and fails loudly if any chart_of_accounts row is missing
 * so the chart of accounts can be corrected before re-running.
 *
 * Run: node migrations/20260610-add-tbill-account-mappings.js
 */

const db = require('../config/database');

const PAIRS = [
  [
    'TBILL_TRADING_ACCOUNT',
    '131-101-350-104-44',
    'Treasury Bills - Trading A/c (T-Bill buy DR / sell+maturity CR cost)'
  ],
  [
    'TBILL_ACCRUAL_ASSET',
    '131-101-350-122-44',
    'Interest Receivable T-Bill - Trading (EOD daily accrual DR / sell+maturity CR)'
  ],
  [
    'TBILL_ACCRUAL_INCOME',
    '467-101-190-482-44',
    'Interest Accrual P&L T-Bill (EOD daily accrual CR)'
  ],
  [
    'TBILL_INTEREST_RECEIVED',
    '358-101-130-410-44',
    'Interest Received on Treasury Bills (maturity income recognition CR)'
  ],
  [
    'TBILL_CAPITAL_GAIN_LOSS',
    '358-101-130-392-44',
    'Profit/Loss on Sales of Treasury Bills (sell P&L plug)'
  ],
  [
    'TBILL_DEFAULT_SETTLEMENT',
    '131-101-410-182-44',
    'Default bank settlement for T-Bill (CR buy / DR sell+maturity when no settlement_mode)'
  ]
];

async function run() {
  const missing = [];
  for (const [, code] of PAIRS) {
    const [rows] = await db.query('SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1', [code]);
    if (!rows.length) missing.push(code);
  }
  if (missing.length) {
    console.error('Missing chart_of_accounts rows for codes:', missing);
    console.error('Add these accounts to chart_of_accounts before re-running this migration.');
    process.exit(1);
  }

  for (const [key, code, description] of PAIRS) {
    await db.query(
      `INSERT INTO account_mappings (mapping_key, account_code, description, is_active, created_at, updated_at)
       VALUES (?, ?, ?, TRUE, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         account_code = VALUES(account_code),
         description = VALUES(description),
         is_active = VALUES(is_active),
         updated_at = NOW()`,
      [key, code, description]
    );
  }

  const keys = PAIRS.map((p) => p[0]);
  const [check] = await db.query(
    `SELECT mapping_key, account_code, is_active FROM account_mappings WHERE mapping_key IN (?)`,
    [keys]
  );
  console.log('T-Bill ledger mappings:', check);
  process.exit(0);
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = run;
