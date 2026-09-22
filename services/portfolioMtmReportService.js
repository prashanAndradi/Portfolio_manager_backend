'use strict';

/**
 * Portfolio Mark to Market - Finance's layout, one row per GSec holding:
 *   Maturity | Face Value Rs. | Coupon | Purchased Yield | Market Yield |
 *   Value as at Purchased Yield | Value as at Market Yield | Profit (Loss) Rs.
 *
 * Both valuations are the clean price per 100 at that yield on the report date
 * (excelBondPricing.priceTripletAtYield - the same pricing the deal screens use), and
 * Profit = face x (market value - purchased value) / 100.
 *
 * Holdings and their remaining face come from the GSec report, so this always agrees with
 * it. Open Sell/Buy buyback positions are excluded - the bond has been sold and the leg-2
 * repurchase has not settled yet, so Finance shows those in a separate "Sell/buy Portfolio"
 * section that this report does not cover. Once leg 2 settles the bond is owned again and
 * the row counts as an ordinary holding here.
 *
 * Market yields come from mark_to_market.average_yield, which holds only the latest quote
 * per ISIN - a back-dated report prices on that date but with today's market yields.
 */

const db = require('../config/db');
const { getGsecReport } = require('./gsecReportService');
const { excelPRICE } = require('./excelBondPricing');

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};
const ymd = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const round = (n, dp) => (n === null || n === undefined ? null : Math.round(Number(n) * 10 ** dp) / 10 ** dp);

/**
 * Clean price per 100 at `yieldRate`, or null when the inputs can't be priced.
 * Uses excelPRICE directly rather than priceTripletAtYield, which rounds to 4dp - Finance's
 * sheet carries the full precision into the profit column.
 */
function valueAtYield({ couponRate, yieldRate, asAtDate, maturityDate }) {
  if (!(Number(couponRate) >= 0) || !(Number(yieldRate) > 0) || !maturityDate) return null;
  try {
    const clean = Number(excelPRICE(new Date(asAtDate), new Date(maturityDate), Number(couponRate) / 100, Number(yieldRate) / 100, 100, 2, 1));
    return Number.isFinite(clean) && clean > 0 ? clean : null;
  } catch (_) {
    return null;
  }
}

/**
 * @param {{asAtDate?: string, portfolio?: string, isin?: string}} filters
 * @returns {Promise<{asAtDate: string, data: object[], totals: object, excluded: object}>}
 */
async function getPortfolioMarkToMarket({ asAtDate, portfolio, isin } = {}) {
  const effectiveAsAt = ymd(asAtDate) || new Date().toISOString().slice(0, 10);

  const report = await getGsecReport({ asAtDate: effectiveAsAt, portfolio, isin });
  const holdings = (report && report.data) || [];
  const dealNumbers = holdings.map((h) => h.deal_number).filter(Boolean);
  if (!dealNumbers.length) {
    return { asAtDate: effectiveAsAt, data: [], totals: { holdings: 0, face_value: 0, profit_loss: 0 }, excluded: { sell_buy: 0, no_market_yield: 0 } };
  }

  // Deal metadata the GSec report does not return: the buyback link (to drop Sell/Buy
  // leg-2 rows) and the ISIN's coupon rate.
  const [meta] = await db.query(
    `SELECT g.deal_number, g.isin_number, g.yield, g.maturity_date, im.coupon_rate,
            (bd.id IS NOT NULL AND bd.leg1_transaction_type = 'Sell' AND bd.leg2_transaction_type = 'Buy'
              AND DATE(bd.leg2_value_date) > DATE(?)) AS is_open_sell_buy
       FROM gsec g
       LEFT JOIN isin_master im ON im.isin_number COLLATE utf8mb4_unicode_ci = g.isin_number COLLATE utf8mb4_unicode_ci
       LEFT JOIN buyback_deals bd ON bd.id = g.buyback_deal_id
      WHERE g.transaction_type = 'Buy' AND g.deal_number IN (?)`,
    [effectiveAsAt, dealNumbers]
  );
  const metaByDeal = Object.fromEntries(meta.map((m) => [m.deal_number, m]));

  const isins = [...new Set(meta.map((m) => m.isin_number).filter(Boolean))];
  const marketYieldByIsin = {};
  if (isins.length) {
    const [quotes] = await db.query(
      'SELECT isin_number, average_yield FROM mark_to_market WHERE isin_number IN (?)',
      [isins]
    );
    quotes.forEach((q) => {
      const y = num(q.average_yield);
      if (y !== null && y > 0) marketYieldByIsin[q.isin_number] = y;
    });
  }

  const rows = [];
  let excludedSellBuy = 0;
  let missingMarketYield = 0;

  for (const holding of holdings) {
    const m = metaByDeal[holding.deal_number];
    if (!m) continue;
    if (Number(m.is_open_sell_buy) === 1) { excludedSellBuy++; continue; }

    const face = num(holding.face_value) || 0;
    if (!(face > 0)) continue;

    const maturityDate = ymd(m.maturity_date);
    const couponRate = num(m.coupon_rate);
    const purchasedYield = num(m.yield);
    const marketYield = marketYieldByIsin[m.isin_number] ?? null;
    if (marketYield === null) missingMarketYield++;

    const valuePurchased = valueAtYield({ couponRate, yieldRate: purchasedYield, asAtDate: effectiveAsAt, maturityDate });
    const valueMarket = valueAtYield({ couponRate, yieldRate: marketYield, asAtDate: effectiveAsAt, maturityDate });
    const profitLoss = valuePurchased !== null && valueMarket !== null
      ? round((face * (valueMarket - valuePurchased)) / 100, 2)
      : null;

    rows.push({
      deal_number: holding.deal_number,
      isin: m.isin_number || '',
      maturity_date: maturityDate,
      face_value: round(face, 2),
      coupon: round(couponRate, 4),
      purchased_yield: round(purchasedYield, 6),
      market_yield: round(marketYield, 4),
      value_at_purchased_yield: valuePurchased,
      value_at_market_yield: valueMarket,
      profit_loss: profitLoss
    });
  }

  rows.sort((a, b) => {
    const am = a.maturity_date || '';
    const bm = b.maturity_date || '';
    if (am !== bm) return am.localeCompare(bm);
    return String(a.deal_number).localeCompare(String(b.deal_number));
  });

  const totals = {
    holdings: rows.length,
    face_value: round(rows.reduce((s, r) => s + (r.face_value || 0), 0), 2),
    profit_loss: round(rows.reduce((s, r) => s + (r.profit_loss || 0), 0), 2)
  };

  return {
    asAtDate: effectiveAsAt,
    data: rows,
    totals,
    excluded: { sell_buy: excludedSellBuy, no_market_yield: missingMarketYield }
  };
}

module.exports = { getPortfolioMarkToMarket, valueAtYield };
