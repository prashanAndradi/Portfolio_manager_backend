/**
 * GSec buy/sell deal ledger account mappings (buyback buy/sell + outright approval).
 * Seeds keys that were defined in accountMappingService but missing from account_mappings,
 * plus GSEC_CAPITAL_GAIN_LOSS for the sell P&L journal.
 *
 * Run: node migrations/20260609-add-gsec-buy-sell-ledger-mappings.js
 */

const db = require('../config/database');

const PAIRS = [
  [
    'GSEC_TRADING_ACCOUNT',
    '131-101-350-098-44',
    'Treasury Bonds - Trading A/c (GSec buy DR / sell CR principal)'
  ],
  [
    'GSEC_ACCRUED_INTEREST_PAID',
    '131-101-350-128-44',
    'Accrued Coupon Interest Paid at Purchase (GSec buy DR / sell CR unwind)'
  ],
  [
    'GSEC_DEFAULT_SETTLEMENT',
    '131-101-410-164-44',
    'Default bank settlement for GSec (CR buy / DR sell when no settlement_mode)'
  ],
  [
    'GSEC_ASSET_TBONDS',
    '131-101-350-098-44',
    'Legacy GSec sell CR when buy deal context is missing'
  ],
  [
    'GSEC_CAPITAL_GAIN_LOSS',
    '358-101-130-398-44',
    'Capital Gain/Loss on Treasury Bond (GSec sell P&L plug)'
  ]
];

async function run() {
  for (const [key, code, description] of PAIRS) {
    const [rows] = await db.query(
      'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
      [code]
    );
    if (!rows.length) {
      console.error(`Missing chart_of_accounts row for code: ${code} (mapping ${key})`);
      process.exit(1);
    }
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
  console.log('GSec buy/sell ledger mappings:', check);
  process.exit(0);
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = run;
