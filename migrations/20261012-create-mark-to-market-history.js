/**
 * Create mark_to_market_history: one market quote per ISIN per quote date.
 * mark_to_market keeps only the latest quote per ISIN (each upload overwrites it), so a
 * back-dated Mark to Market report had no way to find that day's price. The upload code in
 * services/markToMarketService.js (recordQuoteHistory) already writes here once the table
 * exists; until now it logged a warning and skipped because the table was never created.
 *
 * The current mark_to_market rows are copied in as the first history point (dated by their
 * last_updated day) so the table starts with today's known quotes. Earlier days cannot be
 * recovered - they were overwritten.
 */

const db = require('../config/database');

async function up() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS mark_to_market_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      isin_number VARCHAR(50) NOT NULL,
      quote_date DATE NOT NULL,
      series VARCHAR(50) NULL,
      instrument_type VARCHAR(16) NULL,
      isin_issuer VARCHAR(255) NULL,
      maturity_date DATE NULL,
      buying_price DECIMAL(10,4) NULL,
      selling_price DECIMAL(10,4) NULL,
      average_price DECIMAL(10,4) NULL,
      buying_yield DECIMAL(10,4) NULL,
      selling_yield DECIMAL(10,4) NULL,
      average_yield DECIMAL(10,4) NULL,
      dirty_price DECIMAL(10,4) NULL,
      excel_source VARCHAR(255) NULL,
      quote_source VARCHAR(16) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_mtm_history_isin_date (isin_number, quote_date),
      KEY idx_mtm_history_date (quote_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [result] = await db.query(`
    INSERT IGNORE INTO mark_to_market_history (
      isin_number, quote_date, series, instrument_type, isin_issuer, maturity_date,
      buying_price, selling_price, average_price, buying_yield, selling_yield, average_yield,
      dirty_price, excel_source, quote_source
    )
    SELECT TRIM(isin_number), DATE(last_updated), series, instrument_type, isin_issuer, maturity_date,
           buying_price, selling_price, average_price, buying_yield, selling_yield, average_yield,
           dirty_price, excel_source, quote_source
      FROM mark_to_market
     WHERE last_updated IS NOT NULL
  `);
  console.log(`mark_to_market_history ready; seeded ${result.affectedRows} current quote(s).`);
}

if (require.main === module) {
  up()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { up };
