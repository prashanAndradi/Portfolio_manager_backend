'use strict';

/**
 * Market quote in force on a given date.
 *
 * mark_to_market holds only the latest quote per ISIN, so reports run "as at" an earlier date
 * must not read it directly - they would silently price on today's yields. Instead each ISIN
 * gets the most recent quote dated ON OR BEFORE the as-at date (a weekend or holiday uses the
 * previous business day's quote), taken from mark_to_market_history plus the current
 * mark_to_market row (dated by its last_updated day). An ISIN with no quote dated on or before
 * the as-at date gets no entry - callers must show it as unpriced, never substitute a later
 * quote.
 */

const db = require('../config/db');

const ymd = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/**
 * @param {string[]} isins
 * @param {string} asAtDate YYYY-MM-DD
 * @returns {Promise<Object<string, object>>} isin -> quote row with quote_date and quote_origin
 */
async function getQuotesAsAt(isins, asAtDate) {
  const list = [...new Set((isins || []).map((i) => String(i || '').trim()).filter(Boolean))];
  const result = {};
  if (!list.length) return result;
  const asAt = ymd(asAtDate);

  const take = (row, origin) => {
    const isin = String(row.isin_number || '').trim();
    const quoteDate = ymd(origin === 'history' ? row.quote_date : row.last_updated);
    if (!isin || !quoteDate || quoteDate > asAt) return;
    const current = result[isin];
    // On a tie the history row wins: it is dated by the system day the quote applies to.
    if (current && (current.quote_date > quoteDate || (current.quote_date === quoteDate && current.quote_origin === 'history'))) return;
    result[isin] = { ...row, isin_number: isin, quote_date: quoteDate, quote_origin: origin };
  };

  try {
    const [history] = await db.query(
      `SELECT h.* FROM mark_to_market_history h
         JOIN (SELECT isin_number, MAX(quote_date) AS d
                 FROM mark_to_market_history
                WHERE quote_date <= ? AND isin_number IN (?)
                GROUP BY isin_number) x
           ON x.isin_number = h.isin_number AND x.d = h.quote_date`,
      [asAt, list]
    );
    history.forEach((r) => take(r, 'history'));
  } catch (error) {
    // Table not created yet (migration 20261012 not run): fall back to the current quote only.
    if (error.code !== 'ER_NO_SUCH_TABLE') console.warn('MTM history lookup failed:', error.message);
  }

  const [snapshot] = await db.query('SELECT * FROM mark_to_market WHERE TRIM(isin_number) IN (?)', [list]);
  snapshot.forEach((r) => take(r, 'current'));
  return result;
}

module.exports = { getQuotesAsAt };
