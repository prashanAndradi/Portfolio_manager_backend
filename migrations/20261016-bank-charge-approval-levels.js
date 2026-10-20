/**
 * Two-level approval for bank charges.
 *
 *   entered -> pending_verification -> verified -> approved (posted to the GL)
 *
 * Same chain the deal products use (back_office_verifier then
 * back_office_final), so a hand-keyed GL posting gets the same scrutiny as a
 * deal. Adds the verifier stamp columns and moves any charge sitting on the
 * old single-step status onto the first level of the chain.
 *
 * Idempotent: safe to run more than once.
 */

const db = require('../config/database');

async function columnExists(table, column) {
  const [rows] = await db.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

const COLUMNS = [
  ['verified_by', 'VARCHAR(100) DEFAULT NULL'],
  ['verified_at', 'DATETIME DEFAULT NULL'],
  ['created_by_user_id', 'INT DEFAULT NULL'],
  ['verified_by_user_id', 'INT DEFAULT NULL'],
  ['approved_by_user_id', 'INT DEFAULT NULL']
];

async function migrate() {
  for (const [name, definition] of COLUMNS) {
    if (await columnExists('bank_charges', name)) {
      console.log(`  bank_charges.${name} already present`);
      continue;
    }
    await db.query(`ALTER TABLE bank_charges ADD COLUMN ${name} ${definition}`);
    console.log(`  bank_charges.${name} added`);
  }

  // The single-step flow defaulted new charges to 'pending_approval'. Under the
  // two-level chain that status no longer has a meaning, so anything still on
  // it starts again at the first level.
  const [moved] = await db.query(
    "UPDATE bank_charges SET status = 'pending_verification' WHERE status = 'pending_approval'"
  );
  if (moved.affectedRows) {
    console.log(`  moved ${moved.affectedRows} charge(s) from pending_approval to pending_verification`);
  }

  await db.query(
    "ALTER TABLE bank_charges MODIFY COLUMN status VARCHAR(30) NOT NULL DEFAULT 'pending_verification'"
  );
  console.log("  bank_charges.status default is now 'pending_verification'");

  const [[counts]] = await db.query(
    `SELECT
       SUM(status = 'pending_verification') AS awaiting_verification,
       SUM(status = 'verified')             AS awaiting_final,
       SUM(status = 'approved')             AS posted,
       SUM(status = 'rejected')             AS rejected,
       COUNT(*)                             AS total
     FROM bank_charges`
  );
  console.log('  charges by state:', JSON.stringify(counts));
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Bank charge approval-level migration complete');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err.message);
      process.exit(1);
    });
}

module.exports = migrate;
