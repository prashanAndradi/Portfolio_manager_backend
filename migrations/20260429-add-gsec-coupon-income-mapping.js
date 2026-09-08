/**
 * Add/update account mapping for GSec coupon settlement income account:
 *   CR GSEC_COUPON_INCOME -> 467-101-190-476-44 Coupon Interest Income TBond
 *
 * Run: node migrations/20260429-add-gsec-coupon-income-mapping.js
 */

const db = require('../config/database');

const GSEC_COUPON_INCOME_CODE = '467-101-190-476-44';

async function run() {
  const [incomeRows] = await db.query(
    'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [GSEC_COUPON_INCOME_CODE]
  );

  if (!incomeRows.length) {
    console.error(
      'Missing chart_of_accounts row for coupon income code:',
      GSEC_COUPON_INCOME_CODE
    );
    process.exit(1);
  }

  await db.query(
    `INSERT INTO account_mappings (mapping_key, account_code, description, is_active, created_at, updated_at)
     VALUES ('GSEC_COUPON_INCOME', ?, 'Coupon Interest Income TBond', TRUE, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       account_code = VALUES(account_code),
       description = VALUES(description),
       is_active = VALUES(is_active),
       updated_at = NOW()`,
    [GSEC_COUPON_INCOME_CODE]
  );

  const [check] = await db.query(
    `SELECT mapping_key, account_code, description
     FROM account_mappings
     WHERE mapping_key = 'GSEC_COUPON_INCOME'
     LIMIT 1`
  );
  console.log('Updated mapping:', check[0]);
  process.exit(0);
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = run;
