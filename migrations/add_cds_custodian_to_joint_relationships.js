/**
 * Add cds_account and custodian_bank columns to joint_counterparty_relationships.
 * Converted from the original .sql version, which used `ADD COLUMN IF NOT EXISTS` -
 * a clause this environment's MySQL build (reports 8.0.45, "Source distribution")
 * does not actually support, failing with a syntax error on every attempt.
 */
const db = require('../config/db');

async function run() {
  const [columns] = await db.query('DESCRIBE joint_counterparty_relationships');
  const hasCdsAccount = columns.some((col) => col.Field === 'cds_account');
  const hasCustodianBank = columns.some((col) => col.Field === 'custodian_bank');

  if (!hasCdsAccount) {
    await db.query('ALTER TABLE joint_counterparty_relationships ADD COLUMN cds_account VARCHAR(255) AFTER mobile');
    console.log('Added cds_account column');
  } else {
    console.log('cds_account column already exists');
  }

  if (!hasCustodianBank) {
    await db.query('ALTER TABLE joint_counterparty_relationships ADD COLUMN custodian_bank VARCHAR(255) AFTER cds_account');
    console.log('Added custodian_bank column');
  } else {
    console.log('custodian_bank column already exists');
  }
}

if (require.main === module) {
  run()
    .then(() => { console.log('Migration completed'); process.exit(0); })
    .catch((err) => { console.error(err); process.exit(1); });
}

module.exports = run;
