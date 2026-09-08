/**
 * Add deal_number to repo_deals (YYYYMMDD/REPO/0001 or YYYYMMDD/RVREPO/0001),
 * backfill existing deals, and remap ledger/cashflow references from numeric id.
 *
 * Run: npm run migrate
 */

const db = require('../config/database');

function formatValueDateKey(valueDate) {
  const d = valueDate instanceof Date ? valueDate : new Date(valueDate);
  if (Number.isNaN(d.getTime())) return null;
  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}

function getDealTypePrefix(dealType) {
  return String(dealType || '').toLowerCase().includes('reverse') ? 'RVREPO' : 'REPO';
}

async function columnExists(columnName) {
  const [rows] = await db.query(
    `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'repo_deals'
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [columnName]
  );
  return rows.length > 0;
}

async function indexExists(indexName) {
  const [rows] = await db.query(
    `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'repo_deals'
        AND INDEX_NAME = ?
      LIMIT 1`,
    [indexName]
  );
  return rows.length > 0;
}

async function backfillDealNumbers() {
  const [deals] = await db.query(
    `SELECT id, deal_type, value_date
       FROM repo_deals
      WHERE deal_number IS NULL OR TRIM(deal_number) = ''
      ORDER BY value_date ASC, id ASC`
  );

  const counters = {};
  for (const deal of deals) {
    const dateStr = formatValueDateKey(deal.value_date);
    if (!dateStr) {
      console.warn(`Skipping repo deal ${deal.id}: invalid value_date`);
      continue;
    }
    const prefix = getDealTypePrefix(deal.deal_type);
    const key = `${dateStr}/${prefix}`;
    counters[key] = (counters[key] || 0) + 1;
    const dealNumber = `${dateStr}/${prefix}/${String(counters[key]).padStart(4, '0')}`;
    await db.query('UPDATE repo_deals SET deal_number = ? WHERE id = ?', [dealNumber, deal.id]);
  }

  console.log(`Backfilled deal_number for ${deals.length} repo deal(s)`);
}

async function remapLedgerAndCashflow() {
  const [ledgerResult] = await db.query(
    `UPDATE ledger_entries le
     INNER JOIN repo_deals rd
       ON le.deal_number COLLATE utf8mb4_unicode_ci = CAST(rd.id AS CHAR) COLLATE utf8mb4_unicode_ci
     SET le.deal_number = rd.deal_number
     WHERE rd.deal_number IS NOT NULL AND TRIM(rd.deal_number) <> ''`
  );
  console.log(`Remapped ${ledgerResult.affectedRows || 0} ledger entry row(s) to repo deal_number`);

  try {
    const [cashflowResult] = await db.query(
      `UPDATE cashflow_transactions ct
       INNER JOIN repo_deals rd ON ct.reference_number = CONCAT('REPO-', rd.id)
       SET ct.reference_number = rd.deal_number,
           ct.description = REPLACE(ct.description, CONCAT('Deal ', rd.id), CONCAT('Deal ', rd.deal_number))
       WHERE rd.deal_number IS NOT NULL AND TRIM(rd.deal_number) <> ''`
    );
    console.log(`Remapped ${cashflowResult.affectedRows || 0} cashflow row(s) to repo deal_number`);
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
    console.log('cashflow_transactions table not found; skipped cashflow remap');
  }
}

async function run() {
  if (!(await columnExists('deal_number'))) {
    await db.query(
      `ALTER TABLE repo_deals
         ADD COLUMN deal_number VARCHAR(50) NULL AFTER id`
    );
    console.log('Added repo_deals.deal_number column');
  }

  await backfillDealNumbers();

  const [missing] = await db.query(
    `SELECT COUNT(*) AS cnt FROM repo_deals WHERE deal_number IS NULL OR TRIM(deal_number) = ''`
  );
  if (Number(missing[0]?.cnt) > 0) {
    throw new Error(`${missing[0].cnt} repo deal(s) still missing deal_number after backfill`);
  }

  await db.query(
    `ALTER TABLE repo_deals
       MODIFY COLUMN deal_number VARCHAR(50) NOT NULL`
  );

  if (!(await indexExists('unique_repo_deal_number'))) {
    await db.query(
      `ALTER TABLE repo_deals
         ADD UNIQUE INDEX unique_repo_deal_number (deal_number)`
    );
    console.log('Added unique_repo_deal_number index');
  }

  await remapLedgerAndCashflow();
}

if (require.main === module) {
  run()
    .then(() => {
      console.log('Repo deal_number migration completed');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = run;
module.exports.run = run;
