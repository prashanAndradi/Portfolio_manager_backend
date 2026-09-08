/**
 * Add face value adjustment fields to repo_deals.
 *
 * Converted from the original .sql version, which used `ADD COLUMN IF NOT
 * EXISTS` - a clause this environment's MySQL build (reports 8.0.45, "Source
 * distribution") does not actually support, failing with a syntax error.
 */
const db = require('../config/db');

async function columnExists(columnName) {
  const [rows] = await db.query(
    `SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repo_deals' AND COLUMN_NAME = ? LIMIT 1`,
    [columnName]
  );
  return rows.length > 0;
}

async function run() {
  if (!(await columnExists('face_value_adjustment'))) {
    await db.query('ALTER TABLE repo_deals ADD COLUMN face_value_adjustment DECIMAL(20,4) NULL');
    console.log('Added face_value_adjustment column');
  } else {
    console.log('face_value_adjustment column already exists');
  }

  if (!(await columnExists('face_value_as_per_counterparty'))) {
    await db.query('ALTER TABLE repo_deals ADD COLUMN face_value_as_per_counterparty DECIMAL(20,4) NULL');
    console.log('Added face_value_as_per_counterparty column');
  } else {
    console.log('face_value_as_per_counterparty column already exists');
  }
}

if (require.main === module) {
  run()
    .then(() => { console.log('Migration completed'); process.exit(0); })
    .catch((err) => { console.error(err); process.exit(1); });
}

module.exports = run;
