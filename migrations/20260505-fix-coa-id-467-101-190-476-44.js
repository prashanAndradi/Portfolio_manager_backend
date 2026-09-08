/**
 * Fix chart_of_accounts.id for a specific account code if NULL:
 *   467-101-190-476-44 (Coupon Interest Income TBond)
 *
 * Run: node migrations/20260505-fix-coa-id-467-101-190-476-44.js
 */

const { query } = require('../config/database');

const ACCOUNT_CODE = '467-101-190-476-44';

async function run() {
  const [rows] = await query(
    'SELECT id, account_code, name FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [ACCOUNT_CODE]
  );

  if (!rows || rows.length === 0) {
    console.error(`chart_of_accounts row not found for account_code=${ACCOUNT_CODE}`);
    process.exit(1);
  }

  const row = rows[0];
  if (row.id != null) {
    console.log(`OK: chart_of_accounts.id already set for ${ACCOUNT_CODE} (id=${row.id})`);
    process.exit(0);
  }

  const [maxRows] = await query(
    'SELECT COALESCE(MAX(id), 0) AS maxId FROM chart_of_accounts'
  );
  const nextId = Number(maxRows[0].maxId) + 1;

  await query('UPDATE chart_of_accounts SET id = ? WHERE account_code = ? AND id IS NULL', [
    nextId,
    ACCOUNT_CODE,
  ]);

  const [check] = await query(
    'SELECT id, account_code, name FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [ACCOUNT_CODE]
  );
  console.log('Updated:', check[0]);
  process.exit(0);
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = run;

