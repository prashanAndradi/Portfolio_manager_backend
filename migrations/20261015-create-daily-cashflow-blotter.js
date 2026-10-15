/**
 * Daily Cashflow Blotter schema.
 *
 * Two things the blotter needs that nothing else stores:
 *
 *  1. daily_cashflow_opening_balance - the opening cash figure is keyed in by
 *     hand each day (from the bank), so it has to be kept somewhere or the
 *     closing balance cannot be reproduced tomorrow. One row per date.
 *
 *  2. approval columns on bank_charges - a charge affects the blotter the
 *     moment it is entered, but only reaches the general ledger once approved.
 *     The table already existed and was empty; these columns carry the state
 *     between those two points, plus the ledger ids written on approval so the
 *     posting can be found and reversed.
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

const BANK_CHARGE_COLUMNS = [
  ['status', "VARCHAR(30) NOT NULL DEFAULT 'pending_approval'"],
  ['bank_account_code', 'VARCHAR(50) DEFAULT NULL'],
  ['approved_by', 'VARCHAR(100) DEFAULT NULL'],
  ['approved_at', 'DATETIME DEFAULT NULL'],
  ['ledger_entry_ids', 'VARCHAR(100) DEFAULT NULL'],
  ['rejected_by', 'VARCHAR(100) DEFAULT NULL'],
  ['rejected_at', 'DATETIME DEFAULT NULL'],
  ['reject_reason', 'TEXT DEFAULT NULL']
];

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS daily_cashflow_opening_balance (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      balance_date    DATE         NOT NULL,
      opening_balance DECIMAL(18,2) NOT NULL DEFAULT 0,
      currency        VARCHAR(10)  NOT NULL DEFAULT 'LKR',
      notes           TEXT         DEFAULT NULL,
      entered_by      VARCHAR(100) DEFAULT NULL,
      created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_daily_cashflow_opening_date (balance_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  daily_cashflow_opening_balance ready');

  // bank_charges predates this feature; create it if a fresh environment has
  // not run the route's own bootstrap yet, then add the approval columns.
  await db.query(`
    CREATE TABLE IF NOT EXISTS bank_charges (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      entry_date    DATE         NOT NULL,
      bank_name     VARCHAR(255) DEFAULT NULL,
      description   VARCHAR(255) DEFAULT NULL,
      amount        DECIMAL(18,2) NOT NULL DEFAULT 0,
      charge_type   VARCHAR(50)  DEFAULT NULL,
      reference_no  VARCHAR(100) DEFAULT NULL,
      account_code  VARCHAR(50)  DEFAULT NULL,
      created_by    VARCHAR(100) DEFAULT NULL,
      created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  for (const [name, definition] of BANK_CHARGE_COLUMNS) {
    if (await columnExists('bank_charges', name)) {
      console.log(`  bank_charges.${name} already present`);
      continue;
    }
    await db.query(`ALTER TABLE bank_charges ADD COLUMN ${name} ${definition}`);
    console.log(`  bank_charges.${name} added`);
  }

  const [idx] = await db.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bank_charges'
        AND INDEX_NAME = 'idx_bank_charges_entry_date'`
  );
  if (!idx.length) {
    await db.query('ALTER TABLE bank_charges ADD INDEX idx_bank_charges_entry_date (entry_date)');
    console.log('  bank_charges.idx_bank_charges_entry_date added');
  }

  // Existing rows pre-date the approval flow and were never posted, so leaving
  // them at the column default would present them as awaiting approval.
  const [res] = await db.query(
    "UPDATE bank_charges SET status = 'legacy' WHERE status = 'pending_approval' AND created_at < NOW() - INTERVAL 1 MINUTE"
  );
  if (res.affectedRows) console.log(`  marked ${res.affectedRows} pre-existing charge(s) as legacy`);
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Daily Cashflow Blotter migration complete');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err.message);
      process.exit(1);
    });
}

module.exports = migrate;
