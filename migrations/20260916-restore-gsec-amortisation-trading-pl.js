/**
 * Restore GSEC_AMORTISATION_TRADING to the P&L amortisation GL (358-101-130-416-44).
 *
 * 20260914-remap-gsec-amortisation-trading.js pointed it at the balance-sheet GL
 * (131-101-350-134-44) so sale/maturity journals would clear 134. But the daily EOD
 * amortisation uses this key as its P&L side (discount Dr 134 / Cr 416, premium
 * Dr 416 / Cr 134), so with both keys on 134 every daily journal became Dr 134 / Cr 134.
 * Sale and maturity now read GSEC_FINANCIAL_ASSETS_AMORTISED_COST (134) instead, so
 * each purpose has its own key.
 *
 * Guarded on the expected old account_code; re-running is a no-op.
 * Preview: node migrations/20260916-restore-gsec-amortisation-trading-pl.js --dry-run
 * Apply:   node migrations/20260916-restore-gsec-amortisation-trading-pl.js
 */
const db = require('../config/db');

const KEY = 'GSEC_AMORTISATION_TRADING';
const FROM = '131-101-350-134-44';
const TO = '358-101-130-416-44';
const PURPOSE = 'daily amortisation P&L';

async function accountName(conn, code) {
  const [rows] = await conn.query('SELECT name FROM chart_of_accounts WHERE account_code = ? LIMIT 1', [code]);
  return rows.length ? rows[0].name : null;
}

async function run({ dryRun = false } = {}) {
  const conn = await db.getConnection();
  try {
    const newName = await accountName(conn, TO);
    if (!newName) throw new Error(`Target GL ${TO} is not in chart_of_accounts. Aborting.`);
    const newDescription = `${newName} (${PURPOSE})`;
    const [rows] = await conn.query('SELECT account_code, description FROM account_mappings WHERE mapping_key = ? LIMIT 1', [KEY]);
    const current = rows[0] || null;

    let action;
    if (!current) action = 'SKIP - mapping row missing';
    else if (current.account_code === TO && current.description === newDescription) action = 'SKIP - already applied';
    else if (current.account_code === TO) action = 'UPDATE DESCRIPTION ONLY';
    else if (current.account_code === FROM) action = 'UPDATE';
    else action = `SKIP - unexpected current GL ${current.account_code}, left untouched`;

    console.log(`\n${KEY}`);
    console.log(`   from  ${current?.account_code || '(none)'}  ${(current && (await accountName(conn, current.account_code))) || ''}`);
    console.log(`   to    ${TO}  ${newName}`);
    console.log(`   description: "${current?.description || ''}"`);
    console.log(`            ->  "${newDescription}"`);
    console.log(`   => ${action}`);
    if (dryRun || !action.startsWith('UPDATE')) return { action };

    await conn.beginTransaction();
    const expectedCode = action === 'UPDATE' ? FROM : TO;
    const [res] = await conn.query(
      `UPDATE account_mappings SET account_code = ?, description = ?, updated_at = NOW()
        WHERE mapping_key = ? AND account_code = ?`,
      [TO, newDescription, KEY, expectedCode]
    );
    if (res.affectedRows !== 1) throw new Error(`Expected to update 1 row for ${KEY}, updated ${res.affectedRows}. Rolling back.`);
    await conn.commit();
    console.log('Committed.');
    return { action };
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* nothing to roll back */ }
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
