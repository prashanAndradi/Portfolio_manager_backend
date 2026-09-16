/**
 * Re-point GSEC_AMORTISATION_TRADING from the P&L amort GL to the BS
 * Amortised Discount Receivable/Premium Payable TBond - Trading GL
 * (131-101-350-134-44), matching Finance's mapping validation.
 *
 * Target GL already exists in chart_of_accounts - no new account is opened.
 * Guarded on the expected old account_code; re-running is a no-op.
 * Existing ledger entries are untouched; only future postings move.
 *
 * Preview: node migrations/20260914-remap-gsec-amortisation-trading.js --dry-run
 * Apply:   node migrations/20260914-remap-gsec-amortisation-trading.js
 *          (or via npm run migrate)
 */
const db = require('../config/db');

const KEY = 'GSEC_AMORTISATION_TRADING';
const FROM = '358-101-130-416-44';
const TO = '131-101-350-134-44';
const PURPOSE = 'amortisation';

async function accountName(conn, code) {
  const [rows] = await conn.query(
    'SELECT name FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [code]
  );
  return rows.length ? rows[0].name : null;
}

async function run({ dryRun = false } = {}) {
  const conn = await db.getConnection();
  try {
    const newName = await accountName(conn, TO);
    if (!newName) {
      throw new Error(
        `Target GL ${TO} is not in chart_of_accounts. Aborting - this change must not open new GL accounts.`
      );
    }
    const newDescription = `${newName} (${PURPOSE})`;
    const [rows] = await conn.query(
      'SELECT account_code, description FROM account_mappings WHERE mapping_key = ? LIMIT 1',
      [KEY]
    );
    const current = rows[0] || null;

    let action;
    if (!current) action = 'SKIP - mapping row missing';
    else if (current.account_code === TO && current.description === newDescription) {
      action = 'SKIP - already applied';
    } else if (current.account_code === TO) action = 'UPDATE DESCRIPTION ONLY';
    else if (current.account_code === FROM) action = 'UPDATE';
    else action = `SKIP - unexpected current GL ${current.account_code}, left untouched`;

    console.log(`\n${KEY}`);
    console.log(`   from  ${FROM}  ${(await accountName(conn, FROM)) || '(not in chart)'}`);
    console.log(`   to    ${TO}  ${newName}`);
    console.log(`   description: "${current?.description || ''}"`);
    console.log(`            ->  "${newDescription}"`);
    console.log(`   => ${action}`);
    if (dryRun || !action.startsWith('UPDATE')) return { action };

    await conn.beginTransaction();
    const expectedCode = action === 'UPDATE' ? FROM : TO;
    const [res] = await conn.query(
      `UPDATE account_mappings
          SET account_code = ?, description = ?, updated_at = NOW()
        WHERE mapping_key = ? AND account_code = ?`,
      [TO, newDescription, KEY, expectedCode]
    );
    if (res.affectedRows !== 1) {
      throw new Error(`Expected to update 1 row for ${KEY}, updated ${res.affectedRows}. Rolling back.`);
    }
    await conn.commit();
    console.log('Committed.');
    return { action };
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {
      /* nothing to roll back */
    }
    throw err;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  run({ dryRun })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('GL remap failed:', err.message);
      process.exit(1);
    });
}

module.exports = () => run({ dryRun: false });
