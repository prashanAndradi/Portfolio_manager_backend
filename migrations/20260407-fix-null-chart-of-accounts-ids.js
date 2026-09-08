/**
 * Assign sequential numeric ids to chart_of_accounts rows where id IS NULL.
 *
 * Some environments imported chart_of_accounts without a proper PRIMARY KEY / AUTO_INCREMENT,
 * leaving id NULL. Ledger posting requires a non-null id for FK to ledger_entries.account_id.
 *
 * Run: node migrations/20260407-fix-null-chart-of-accounts-ids.js
 */

const { query } = require('../config/database');

async function run() {
  const [maxRows] = await query(
    'SELECT COALESCE(MAX(id), 0) AS maxId FROM chart_of_accounts'
  );
  const maxId = maxRows[0].maxId;
  const [nullRows] = await query(
    'SELECT account_code FROM chart_of_accounts WHERE id IS NULL ORDER BY account_code'
  );
  if (!nullRows.length) {
    console.log('No chart_of_accounts rows with NULL id. Nothing to do.');
    return;
  }
  let next = Number(maxId) + 1;
  console.log(`Assigning ids from ${next} for ${nullRows.length} row(s) with NULL id.`);
  for (const row of nullRows) {
    await query('UPDATE chart_of_accounts SET id = ? WHERE account_code = ? AND id IS NULL', [
      next,
      row.account_code,
    ]);
    console.log(`  ${row.account_code} -> id ${next}`);
    next += 1;
  }
  const [check] = await query(
    'SELECT id, account_code FROM chart_of_accounts WHERE id IS NULL'
  );
  if (check.length) {
    throw new Error('Still have NULL ids: ' + JSON.stringify(check));
  }
  console.log('Done. All chart_of_accounts rows now have non-null id.');
}

// Unlike every other migration in this repo, this file used to call run()
// and process.exit() UNCONDITIONALLY at module load time, with no
// `require.main === module` guard. Since process.exit() kills the entire
// Node process regardless of what required the module, the instant the
// migration runner `require()`d this file (not "ran" it - just loaded it),
// the whole migration run was silently killed mid-chain with exit code 0,
// abandoning every migration after this one with no error and no summary.
if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = run;
