/**
 * Add a propose/approve workflow to dealer_limits: a middle_office_user
 * proposes a limit change (staged in pending_* columns), and a
 * middle_office_officer or middle_office_manager approves it before it
 * becomes the active, enforced limit. Officer/manager's own direct edits
 * bypass this (they write straight to the active columns, unchanged).
 *
 * Uses existence-checked ALTER statements rather than `ADD COLUMN IF NOT
 * EXISTS` - this environment's MySQL build doesn't actually support that
 * clause despite reporting version 8.0.45 (see migrations fixed 2026-09-07).
 */
const db = require('../config/db');

async function columnExists(columnName) {
  const [rows] = await db.query(
    `SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dealer_limits' AND COLUMN_NAME = ? LIMIT 1`,
    [columnName]
  );
  return rows.length > 0;
}

async function addColumnIfMissing(columnName, definition) {
  if (await columnExists(columnName)) {
    console.log(`dealer_limits.${columnName} already exists`);
    return;
  }
  await db.query(`ALTER TABLE dealer_limits ADD COLUMN ${columnName} ${definition}`);
  console.log(`Added dealer_limits.${columnName}`);
}

async function run() {
  await addColumnIfMissing('pending_per_deal_limit', 'DECIMAL(20,4) NULL');
  await addColumnIfMissing('pending_per_day_limit', 'DECIMAL(20,4) NULL');
  await addColumnIfMissing('proposed_by', 'INT NULL');
  await addColumnIfMissing('proposed_at', 'TIMESTAMP NULL');
  await addColumnIfMissing('approved_by', 'INT NULL');
  await addColumnIfMissing('approved_at', 'TIMESTAMP NULL');
  await addColumnIfMissing('rejected_by', 'INT NULL');
  await addColumnIfMissing('rejected_at', 'TIMESTAMP NULL');
  await addColumnIfMissing('rejection_reason', 'VARCHAR(500) NULL');
}

if (require.main === module) {
  run()
    .then(() => { console.log('Migration completed'); process.exit(0); })
    .catch((err) => { console.error(err); process.exit(1); });
}

module.exports = run;
