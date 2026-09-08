/**
 * Reverse Repo maturity interest expense: map the interest leg booked at maturity
 * to its own expense account "Interest Expense Repo Borrowing" (669-101-240-768-44),
 * separate from the daily-accrual expense account (669-101-240-752-44).
 *
 * Run: node migrations/20260603-add-reverse-repo-maturity-interest-expense-mapping.js
 * Requires chart_of_accounts row for account_code 669-101-240-768-44.
 */

const db = require('../config/database');

const CODE = '669-101-240-768-44';
const KEY = 'REVERSE_REPO_MATURITY_INTEREST_EXPENSE';

async function run() {
  const [rows] = await db.query(
    'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [CODE]
  );
  if (!rows.length) {
    console.error(
      `Missing chart_of_accounts row for ${CODE}. Add "Interest Expense Repo Borrowing" to the chart, then re-run.`
    );
    process.exit(1);
  }

  await db.query(
    `INSERT INTO account_mappings (mapping_key, account_code, description, is_active, created_at, updated_at)
     VALUES (?, ?, ?, TRUE, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       account_code = VALUES(account_code),
       description = VALUES(description),
       is_active = TRUE,
       updated_at = NOW()`,
    [KEY, CODE, 'Interest Expense Repo Borrowing (repo maturity interest expense)']
  );

  const [check] = await db.query(
    'SELECT mapping_key, account_code, description, is_active FROM account_mappings WHERE mapping_key = ?',
    [KEY]
  );
  console.log('REVERSE_REPO_MATURITY_INTEREST_EXPENSE mapping:', check);
  process.exit(0);
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = run;
