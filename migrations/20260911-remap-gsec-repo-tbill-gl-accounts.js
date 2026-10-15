/**
 * Re-point GSec / Repo / T-Bill account mappings at the GLs requested by the
 * business (GL mapping change request, 2026-09-11).
 *
 * Every target GL already exists in chart_of_accounts - by instruction, NO new
 * GL accounts are opened. If any target is missing the whole run aborts.
 *
 * Several mappings intentionally consolidate onto one GL (confirmed by the
 * business): both TBond income keys land on 358-101-130-404-44, and the repo
 * maturity-interest key joins the daily-accrual account 669-101-240-752-44.
 * Each description keeps a purpose suffix - e.g. "(coupon settlement)" vs
 * "(daily accrual)" - so keys sharing a GL stay distinguishable in the admin
 * screen (also confirmed by the business).
 *
 * FD_ACCRUAL_ASSET and FD_ACCRUAL_INCOME are deliberately EXCLUDED. They share
 * 131-101-290-218-44 and 467-101-190-470-44 with GSec, but the business
 * confirmed Fixed Deposit stays on the existing GLs - only GSec moves.
 *
 * Safety:
 *   - each update is guarded on the expected OLD account_code, so a mapping
 *     someone has since changed by hand is reported and left alone
 *   - already-applied rows are skipped, so re-running is a no-op
 *   - all updates run in one transaction: all apply, or none do
 *
 * Preview without writing:
 *   node migrations/20260911-remap-gsec-repo-tbill-gl-accounts.js --dry-run
 * Apply:
 *   node migrations/20260911-remap-gsec-repo-tbill-gl-accounts.js
 *   (or via npm run migrate)
 *
 * Only affects where FUTURE postings go. Existing ledger entries are untouched.
 */
const db = require('../config/db');

const REMAPS = [
  { key: 'REVERSE_REPO_MATURITY_INTEREST_EXPENSE', from: '669-101-240-768-44', to: '669-101-240-752-44', purpose: 'maturity interest expense' },
  { key: 'REVERSE_REPO_INTEREST_PAYABLE',          from: '249-101-330-780-44', to: '249-101-330-314-44', purpose: 'daily accrual' },
  { key: 'TBILL_ACCRUAL_INCOME',                   from: '467-101-190-482-44', to: '358-101-130-410-44', purpose: 'daily accrual' },
  { key: 'GSEC_ACCRUAL_ASSET',                     from: '131-101-290-218-44', to: '131-101-350-116-44', purpose: 'daily accrual' },
  { key: 'GSEC_COUPON_INCOME',                     from: '467-101-190-476-44', to: '358-101-130-404-44', purpose: 'coupon settlement' },
  { key: 'GSEC_ACCRUAL_INCOME',                    from: '467-101-190-470-44', to: '358-101-130-404-44', purpose: 'daily accrual' },
  { key: 'GSEC_FINANCIAL_ASSETS_AMORTISED_COST',   from: '131-101-170-044-44', to: '131-101-350-134-44', purpose: 'daily amortisation' },
];

// Keys that share an old GL with the remaps above but must NOT move.
const EXCLUDED_KEYS = ['FD_ACCRUAL_ASSET', 'FD_ACCRUAL_INCOME'];

async function accountName(conn, code) {
  const [rows] = await conn.query(
    'SELECT name FROM chart_of_accounts WHERE account_code = ? LIMIT 1', [code]
  );
  return rows.length ? rows[0].name : null;
}

async function buildPlan(conn) {
  const plan = [];
  for (const r of REMAPS) {
    const newName = await accountName(conn, r.to);
    if (!newName) {
      throw new Error(
        `Target GL ${r.to} (for ${r.key}) is not in chart_of_accounts. ` +
        'Aborting - this change must not open new GL accounts.'
      );
    }
    const [rows] = await conn.query(
      'SELECT account_code, description FROM account_mappings WHERE mapping_key = ? LIMIT 1', [r.key]
    );
    const current = rows[0] || null;
    const newDescription = `${newName} (${r.purpose})`;
    let action;
    if (!current) action = 'SKIP - mapping row missing';
    else if (current.account_code === r.to && current.description === newDescription) action = 'SKIP - already applied';
    else if (current.account_code === r.to) action = 'UPDATE DESCRIPTION ONLY';
    else if (current.account_code === r.from) action = 'UPDATE';
    else action = `SKIP - unexpected current GL ${current.account_code}, left untouched`;
    plan.push({
      ...r,
      action,
      currentCode: current?.account_code || null,
      currentDescription: current?.description || null,
      oldName: await accountName(conn, r.from),
      newName,
      newDescription
    });
  }
  return plan;
}

async function printPlan(conn, plan, dryRun) {
  console.log(`\nGL mapping change - ${dryRun ? 'PREVIEW (dry run, nothing written)' : 'APPLYING'}`);
  console.log('-'.repeat(100));
  for (const p of plan) {
    console.log(`${p.key}`);
    console.log(`   from  ${p.from}  ${p.oldName || '(not in chart)'}`);
    console.log(`   to    ${p.to}  ${p.newName}`);
    console.log(`   description: "${p.currentDescription || ''}"`);
    console.log(`            ->  "${p.newDescription}"`);
    console.log(`   => ${p.action}`);
  }
  console.log('-'.repeat(100));

  // Every key that will sit on each target GL afterwards, to show the
  // consolidated ones remain distinguishable by description.
  const targets = [...new Set(plan.map((p) => p.to))];
  console.log('Keys on each target GL after the change:');
  for (const gl of targets) {
    const moving = plan.filter((p) => p.to === gl);
    const [already] = await conn.query(
      `SELECT mapping_key, description FROM account_mappings
        WHERE account_code = ? AND mapping_key NOT IN (${moving.map(() => '?').join(',')})`,
      [gl, ...moving.map((m) => m.key)]
    );
    console.log(`   ${gl}`);
    for (const m of moving) console.log(`      ${m.key.padEnd(40)} "${m.newDescription}"`);
    for (const a of already) console.log(`      ${a.mapping_key.padEnd(40)} "${a.description}"  (already here)`);
  }

  const [excluded] = await conn.query(
    `SELECT mapping_key, account_code FROM account_mappings
     WHERE mapping_key IN (${EXCLUDED_KEYS.map(() => '?').join(',')})`, EXCLUDED_KEYS
  );
  console.log('Unchanged by design (Fixed Deposit stays on existing GLs):');
  for (const e of excluded) console.log(`   ${e.mapping_key.padEnd(40)} stays on ${e.account_code}`);
  const updates = plan.filter((p) => p.action.startsWith('UPDATE')).length;
  console.log(`\n${updates} of ${plan.length} mapping(s) ${dryRun ? 'would be' : 'will be'} updated.`);
}

async function run({ dryRun = false } = {}) {
  const conn = await db.getConnection();
  try {
    const plan = await buildPlan(conn);
    await printPlan(conn, plan, dryRun);
    if (dryRun) return plan;

    await conn.beginTransaction();
    for (const p of plan.filter((x) => x.action.startsWith('UPDATE'))) {
      // Guard on the value we planned against, so a concurrent change aborts
      // the whole transaction instead of being silently overwritten.
      const expectedCode = p.action === 'UPDATE' ? p.from : p.to;
      const [res] = await conn.query(
        `UPDATE account_mappings
            SET account_code = ?, description = ?, updated_at = NOW()
          WHERE mapping_key = ? AND account_code = ?`,
        [p.to, p.newDescription, p.key, expectedCode]
      );
      if (res.affectedRows !== 1) {
        throw new Error(`Expected to update 1 row for ${p.key}, updated ${res.affectedRows}. Rolling back.`);
      }
    }
    await conn.commit();
    console.log('Committed.');
    return plan;
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
    .catch((err) => { console.error('GL remap failed:', err.message); process.exit(1); });
}

// Migration runner entry point - applies the change.
module.exports = () => run({ dryRun: false });
