/**
 * Allow one Buy AND one Sell GSEC row per buyback_deal_id (letter row for leg1 Sell).
 * Replaces unique(buyback_deal_id) with unique(buyback_deal_id, transaction_type).
 */
const db = require('../config/database');

async function run() {
  const [oldIdx] = await db.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'gsec'
       AND INDEX_NAME = 'uq_gsec_buyback_deal_id'
     LIMIT 1`
  );
  if (oldIdx.length) {
    await db.query('ALTER TABLE gsec DROP INDEX uq_gsec_buyback_deal_id');
    console.log('Dropped unique index uq_gsec_buyback_deal_id');
  } else {
    console.log('uq_gsec_buyback_deal_id not present (ok)');
  }

  const [newIdx] = await db.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'gsec'
       AND INDEX_NAME = 'uq_gsec_buyback_deal_id_txn'
     LIMIT 1`
  );
  if (!newIdx.length) {
    await db.query(
      `CREATE UNIQUE INDEX uq_gsec_buyback_deal_id_txn ON gsec (buyback_deal_id, transaction_type)`
    );
    console.log('Created unique index uq_gsec_buyback_deal_id_txn on gsec(buyback_deal_id, transaction_type)');
  } else {
    console.log('uq_gsec_buyback_deal_id_txn already exists');
  }
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration 20260803-gsec-buyback-deal-id-txn-unique failed:', err);
      process.exit(1);
    });
}

module.exports = run;
