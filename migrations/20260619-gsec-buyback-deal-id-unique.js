/**
 * Deduplicate leg2 GSEC rows per buyback_deal_id and enforce one link per buyback.
 */
const db = require('../config/database');

async function run() {
  // Cancelled rows must not retain buyback_deal_id (blocks unique index).
  const [cleared] = await db.query(
    `UPDATE gsec
     SET buyback_deal_id = NULL, updated_at = NOW()
     WHERE buyback_deal_id IS NOT NULL
       AND COALESCE(status, '') = 'cancelled'`
  );
  if (cleared.affectedRows) {
    console.log(`Cleared buyback_deal_id on ${cleared.affectedRows} cancelled gsec row(s)`);
  }

  const [dupGroups] = await db.query(
    `SELECT buyback_deal_id, GROUP_CONCAT(id ORDER BY id) AS ids, COUNT(*) AS cnt
     FROM gsec
     WHERE buyback_deal_id IS NOT NULL
       AND transaction_type = 'Buy'
       AND COALESCE(status, '') <> 'cancelled'
     GROUP BY buyback_deal_id
     HAVING cnt > 1`
  );

  for (const g of dupGroups || []) {
    const ids = String(g.ids).split(',').map(Number).filter(Boolean);
    const keepId = ids[0];
    const cancelIds = ids.slice(1);
    if (!cancelIds.length) continue;

    console.log(`buyback_deal_id=${g.buyback_deal_id}: keep gsec id ${keepId}, cancel ${cancelIds.join(',')}`);

    for (const cancelId of cancelIds) {
      const [le] = await db.query(
        'SELECT COUNT(*) AS c FROM ledger_entries le JOIN gsec g ON g.deal_number = le.deal_number WHERE g.id = ?',
        [cancelId]
      );
      if (Number(le[0].c) > 0) {
        console.warn(`  Skip cancel id ${cancelId} — has ledger entries`);
        continue;
      }
      await db.query(
        `UPDATE gsec
         SET status = 'cancelled',
             per_day_accrual = 0,
             buyback_deal_id = NULL,
             updated_at = NOW()
         WHERE id = ?`,
        [cancelId]
      );
    }
  }

  const [idxRows] = await db.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'gsec'
       AND INDEX_NAME = 'uq_gsec_buyback_deal_id'
     LIMIT 1`
  );

  if (!idxRows.length) {
    await db.query(
      `CREATE UNIQUE INDEX uq_gsec_buyback_deal_id ON gsec (buyback_deal_id)`
    );
    console.log('Created unique index uq_gsec_buyback_deal_id on gsec(buyback_deal_id)');
  } else {
    console.log('Unique index uq_gsec_buyback_deal_id already exists');
  }
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration 20260619-gsec-buyback-deal-id-unique failed:', err);
      process.exit(1);
    });
}

module.exports = run;
