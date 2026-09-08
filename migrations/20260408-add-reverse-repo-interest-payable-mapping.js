/**
 * Reverse Repo daily interest accrual: credit Interest Payable Repo Borrowing (249-101-330-780-44)
 * instead of the principal Repo liability (249-101-330-308-44).
 *
 * Run: node migrations/20260408-add-reverse-repo-interest-payable-mapping.js
 * Requires chart_of_accounts row for account_code 249-101-330-780-44.
 */

const db = require('../config/database');

const CODE = '249-101-330-780-44';
const KEY = 'REVERSE_REPO_INTEREST_PAYABLE';

async function run() {
  const [rows] = await db.query(
    'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [CODE]
  );
  if (!rows.length) {
    console.error(
      `Missing chart_of_accounts row for ${CODE}. Add "Interest Payable Repo Borrowing" to the chart, then re-run.`
    );
    process.exit(1);
  }

  await db.query(
    `INSERT INTO account_mappings (mapping_key, account_code, description, is_active, created_at, updated_at)
     VALUES (?, ?, ?, TRUE, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       account_code = VALUES(account_code),
       description = VALUES(description),
       updated_at = NOW()`,
    [KEY, CODE, 'Interest Payable Repo Borrowing']
  );

  const [check] = await db.query(
    'SELECT mapping_key, account_code, description FROM account_mappings WHERE mapping_key = ?',
    [KEY]
  );
  console.log('REVERSE_REPO_INTEREST_PAYABLE mapping:', check);
  process.exit(0);
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = run;
