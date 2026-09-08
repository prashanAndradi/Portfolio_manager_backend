/**
 * Deduplicate leg2 GSEC rows per buyback_deal_id.
 *
 * This used to also create a single-column UNIQUE index on
 * gsec(buyback_deal_id) - but a buyback legitimately has one 'Buy' row and
 * one 'Sell' row sharing the same buyback_deal_id (opening and closing
 * legs), so that index was wrong and failed on every real buyback pair.
 * 20260803-gsec-buyback-deal-id-txn-unique.js (which runs right after this
 * one) creates the correct two-column index on
 * (buyback_deal_id, transaction_type) instead - this file only handles
 * clearing cancelled rows and cancelling genuine same-type duplicates.
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
