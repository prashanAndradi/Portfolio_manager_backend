/**
 * GSec daily premium/discount amortization (EOD) account mappings:
 *   GSEC_AMORTISATION_TRADING          -> 358-101-130-416-44
 *   GSEC_FINANCIAL_ASSETS_AMORTISED_COST -> 111-101-170-044-44
 *
 * Run: node migrations/20260501-add-gsec-amortization-mappings.js
 */

const db = require('../config/database');

const PAIRS = [
  [
    'GSEC_AMORTISATION_TRADING',
    '358-101-130-416-44',
    'Amortised Discount Received/Premium Paid TBonds - Trading'
  ],
  [
    'GSEC_FINANCIAL_ASSETS_AMORTISED_COST',
    '111-101-170-044-44',
    'Financial Assets at amortised cost'
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
  const [check] = await db.query(
    `SELECT mapping_key, account_code FROM account_mappings
     WHERE mapping_key IN ('GSEC_AMORTISATION_TRADING', 'GSEC_FINANCIAL_ASSETS_AMORTISED_COST')`
  );
  console.log('GSec amortization mappings:', check);
  process.exit(0);
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = run;
