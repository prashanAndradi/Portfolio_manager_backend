const db = require('../config/database');

async function run() {
  const [rows] = await db.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'gsec'
       AND COLUMN_NAME = 'buyback_deal_id'
     LIMIT 1`
  );

  if (rows.length > 0) {
    console.log('buyback_deal_id already exists on gsec, skipping.');
    return;
  }

  await db.query(
    `ALTER TABLE gsec
     ADD COLUMN buyback_deal_id INT NULL AFTER buy_deal_number`
  );

  await db.query(
    `CREATE INDEX idx_gsec_buyback_deal_id ON gsec(buyback_deal_id)`
  );

  console.log('Added gsec.buyback_deal_id and index idx_gsec_buyback_deal_id.');
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Failed migration 20260409-add-buyback-deal-id-to-gsec:', err);
      process.exit(1);
    });
}

module.exports = run;

