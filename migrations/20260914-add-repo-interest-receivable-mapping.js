/**
 * Reverse Repo daily interest accrual: debit its own receivable GL
 * "Interest Receivable on Rev Repo with Banks and Other Financial Institutes"
 * (131-101-350-222-44) instead of capitalising the interest onto the principal
 * asset 131-101-410-206-44.
 *
 * The principal GL then only ever shows the amount lent, and Reverse Repo
 * maturity clears the receivable with its own leg.
 *
 * Run: node migrations/20260914-add-repo-interest-receivable-mapping.js
 * Requires a chart_of_accounts row for account_code 131-101-350-222-44.
 * Existing ledger entries are untouched; only future postings move.
 */
const db = require('../config/database');

const CODE = '131-101-350-222-44';
const KEY = 'REPO_INTEREST_RECEIVABLE';

async function run() {
  const [rows] = await db.query(
    'SELECT name FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [CODE]
  );
  if (!rows.length) {
    throw new Error(
      `Missing chart_of_accounts row for ${CODE}. Add "Interest Receivable on Rev Repo with ` +
      'Banks and Other Financial Institutes" to the chart, then re-run. ' +
      'This change must not open new GL accounts.'
    );
  }
  const description = `${rows[0].name} (daily accrual)`;

  await db.query(
    `INSERT INTO account_mappings (mapping_key, account_code, description, is_active, created_at, updated_at)
     VALUES (?, ?, ?, TRUE, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       account_code = VALUES(account_code),
       description = VALUES(description),
       is_active = TRUE,
       updated_at = NOW()`,
    [KEY, CODE, description]
  );

  const [check] = await db.query(
    'SELECT mapping_key, account_code, description, is_active FROM account_mappings WHERE mapping_key = ?',
    [KEY]
  );
  console.log('REPO_INTEREST_RECEIVABLE mapping:', check);
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('Repo interest receivable mapping failed:', e.message);
      process.exit(1);
    });
}

module.exports = run;
