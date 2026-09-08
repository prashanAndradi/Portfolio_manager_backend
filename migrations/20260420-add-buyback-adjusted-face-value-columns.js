/**
 * Add adjusted face value capture for buyback legs.
 * These fields preserve user-entered face adjustments while allowing
 * settlement calculations to continue from the base face value.
 *
 * Converted from the original .sql version, which used `ADD COLUMN IF NOT
 * EXISTS` - a clause this environment's MySQL build (reports 8.0.45, "Source
 * distribution") does not actually support, failing with a syntax error.
 */
const db = require('../config/db');

async function columnExists(columnName) {
  const [rows] = await db.query(
    `SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'buyback_deals' AND COLUMN_NAME = ? LIMIT 1`,
    [columnName]
  );
  return rows.length > 0;
}

async function run() {
  if (!(await columnExists('leg1_adjusted_face_value'))) {
    await db.query('ALTER TABLE buyback_deals ADD COLUMN leg1_adjusted_face_value DECIMAL(18,2) NULL AFTER leg1_face_value');
    console.log('Added leg1_adjusted_face_value column');
  } else {
    console.log('leg1_adjusted_face_value column already exists');
  }

  if (!(await columnExists('leg2_adjusted_face_value'))) {
    await db.query('ALTER TABLE buyback_deals ADD COLUMN leg2_adjusted_face_value DECIMAL(18,2) NULL AFTER leg2_face_value');
    console.log('Added leg2_adjusted_face_value column');
  } else {
    console.log('leg2_adjusted_face_value column already exists');
  }
}

if (require.main === module) {
  run()
    .then(() => { console.log('Migration completed'); process.exit(0); })
    .catch((err) => { console.error(err); process.exit(1); });
}

module.exports = run;
