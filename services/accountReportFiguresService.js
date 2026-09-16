'use strict';

/**
 * As-at "As per Report" figures for GSec Balance Sheet reconciliation.
 * Maps product-report holdings totals onto the GL codes they should post to.
 */

const gsecReportService = require('./gsecReportService');
const tbillReportService = require('./tbillReportService');
const buybackReportService = require('./buybackReportService');
const repoReportService = require('./repoReportService');
const db = require('../config/database');
const {
  computeGsecPerDayAccrual,
  computeGsecDailyAmortization
} = require('./gsecCouponPeriod');

const parseNum = (v) => Number(String(v ?? '0').replace(/,/g, '')) || 0;

const sumField = (rows, field) =>
  (rows || []).reduce((s, r) => s + parseNum(r[field]), 0);

function clampToYmd(v) {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function utcDayDiffSigned(endYmd, startYmd) {
  if (!endYmd || !startYmd) return 0;
  const t0 = Date.UTC(+startYmd.slice(0, 4), +startYmd.slice(5, 7) - 1, +startYmd.slice(8, 10));
  const t1 = Date.UTC(+endYmd.slice(0, 4), +endYmd.slice(5, 7) - 1, +endYmd.slice(8, 10));
  return Math.round((t1 - t0) / 86400000);
}

function addUtcDays(ymd, days) {
  const t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
  const d = new Date(t + days * 86400000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isBuySellRow(row) {
  const t = String(row.transaction_type || '').toLowerCase().replace(/\s+/g, '');
  return t === 'buy/sell' || t === 'buy-sell' || t === 'buysell';
}

/**
 * Open Buy/Sell buyback principal + accrued-at-purchase from the buyback report.
 */
function sumBuySellBuybackHoldings(buybackRows) {
  let cleanTotal = 0;
  let accruedAtPurchase = 0;
  for (const row of buybackRows || []) {
    if (!isBuySellRow(row)) continue;
    const face = parseNum(row.face_value);
    const clean = parseNum(row.leg1_clean_price);
    const dirty = parseNum(row.leg1_dirty_price);
    // Prefer report amount when present; otherwise recompute from adjusted face.
    const cleanAmt =
      row.leg1_clean_price_amount != null && row.leg1_clean_price_amount !== ''
        ? parseNum(row.leg1_clean_price_amount)
        : (clean * face) / 100;
    const dirtyAmt = (dirty * face) / 100;
    cleanTotal += cleanAmt;
    accruedAtPurchase += dirtyAmt - cleanAmt;
  }
  return { cleanTotal, accruedAtPurchase };
}

/**
 * Cumulative accrual / amortisation for open Buy/Sell buybacks as at asAtDate,
 * mirroring EOD per-day posting (sum of daily amounts from leg1 value date → as at).
 */
async function sumBuySellAccrualAmort(asAtDate) {
  const asAtYmd = clampToYmd(asAtDate);
  if (!asAtYmd) return { accrual: 0, amort: 0 };

  const [rows] = await db.query(
    `SELECT
       bd.id,
       bd.deal_number,
       bd.leg1_isin,
       bd.leg1_value_date,
       bd.leg2_value_date,
       bd.leg1_face_value,
       bd.leg1_adjusted_face_value,
       bd.leg1_clean_price,
       bd.coupon_rate,
       bd.coupon_date1,
       bd.coupon_date2,
       bd.maturity_date,
       im.issue_date AS isin_issue_date,
       im.maturity_date AS isin_maturity_date,
       im.coupon_rate AS isin_coupon_rate,
       im.coupon_date_1 AS isin_coupon_date_1,
       im.coupon_date_2 AS isin_coupon_date_2
     FROM buyback_deals bd
     LEFT JOIN isin_master im
       ON bd.leg1_isin COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE bd.deal_status = 'Approved'
       AND LOWER(TRIM(bd.leg1_transaction_type)) = 'buy'
       AND LOWER(TRIM(bd.leg2_transaction_type)) = 'sell'
       AND bd.leg1_value_date IS NOT NULL
       AND bd.leg2_value_date IS NOT NULL
       AND DATE(bd.leg1_value_date) <= DATE(?)
       AND DATE(bd.leg2_value_date) > DATE(?)`,
    [asAtYmd, asAtYmd]
  );

  let accrual = 0;
  let amort = 0;

  for (const bb of rows || []) {
    const face =
      bb.leg1_adjusted_face_value != null && bb.leg1_adjusted_face_value !== ''
        ? parseNum(bb.leg1_adjusted_face_value)
        : parseNum(bb.leg1_face_value);
    if (face <= 0) continue;

    const startYmd = clampToYmd(bb.leg1_value_date);
    const matYmd = clampToYmd(bb.leg2_value_date || bb.maturity_date || bb.isin_maturity_date);
    if (!startYmd || !matYmd) continue;

    let endYmd = asAtYmd;
    if (endYmd > matYmd) endYmd = matYmd;
    // Holding days exclude maturity / leg2 day (same convention as GSec amort).
    let holdingDays = Math.max(0, utcDayDiffSigned(endYmd, startYmd));
    if (endYmd === matYmd) holdingDays = Math.max(0, holdingDays - 1);
    if (holdingDays <= 0) continue;

    const dealCtx = {
      face_value: face,
      remaining_face_value: face,
      clean_price: bb.leg1_clean_price,
      value_date: bb.leg1_value_date,
      maturity_date: matYmd,
      coupon_rate: parseNum(bb.coupon_rate ?? bb.isin_coupon_rate),
      coupon_interest: null,
      isin_number: bb.leg1_isin,
      coupon_date_1: bb.coupon_date1 || bb.isin_coupon_date_1,
      coupon_date_2: bb.coupon_date2 || bb.isin_coupon_date_2
    };

    // Walk each holding day so coupon-period changes in per-day accrual are reflected.
    for (let i = 0; i < holdingDays; i += 1) {
      const dayYmd = addUtcDays(startYmd, i);
      const acc = computeGsecPerDayAccrual(dealCtx, dayYmd, 2);
      if (acc.ok) accrual += Number(acc.amount) || 0;
      const am = computeGsecDailyAmortization(dealCtx, dayYmd);
      if (am.ok) amort += Number(am.amount) || 0;
    }
  }

  return { accrual, amort };
}

/**
 * Open repo / reverse-repo principal and accrued interest as at asAtDate.
 */
function sumRepoFigures(repoRows, asAtDate) {
  const asAtYmd = clampToYmd(asAtDate);
  let repoPrincipal = 0;
  let reverseRepoPrincipal = 0;
  let repoInterestPayable = 0;
  let reverseRepoInterestPayable = 0;

  for (const row of repoRows || []) {
    const dealType = String(row.deal_type || '').trim();
    const principal = parseNum(row.principal_amount);
    const interest = parseNum(row.interest_amount);
    const tenor = parseNum(row.tenor) || 0;
    const valueYmd = clampToYmd(row.value_date);
    const matYmd = clampToYmd(row.maturity_date);

    let accrued = 0;
    if (interest > 0 && tenor > 0 && valueYmd && asAtYmd) {
      let elapsed = Math.max(0, utcDayDiffSigned(asAtYmd, valueYmd));
      if (matYmd && asAtYmd >= matYmd) {
        elapsed = Math.max(0, utcDayDiffSigned(matYmd, valueYmd));
      }
      elapsed = Math.min(elapsed, tenor);
      accrued = (interest * elapsed) / tenor;
    }

    if (dealType === 'Repo') {
      repoPrincipal += principal;
      repoInterestPayable += accrued;
    } else if (dealType === 'Reverse Repo') {
      reverseRepoPrincipal += principal;
      reverseRepoInterestPayable += accrued;
    }
  }

  return {
    repoPrincipal,
    reverseRepoPrincipal,
    repoInterestPayable,
    reverseRepoInterestPayable
  };
}

/**
 * @param {string} asAtDate YYYY-MM-DD
 * @returns {Promise<{ asAtDate: string, figures: Record<string, number> }>}
 */
async function getAccountReportFigures(asAtDate) {
  const [gsecResult, tbillResult, buybackResult, repoResult, buySellAccrualAmort] =
    await Promise.all([
      gsecReportService.getGsecReport({ asAtDate, page: 1, pageSize: 100000 }),
      tbillReportService.getTbillReport({ asAtDate, page: 1, pageSize: 100000 }),
      buybackReportService.getBuybackReport({
        asAtDate,
        transactionPair: 'buy_sell',
        page: 1,
        pageSize: 100000
      }),
      repoReportService.getRepoReport({ asAtDate, page: 1, pageSize: 100000 }),
      sumBuySellAccrualAmort(asAtDate)
    ]);

  const gsecRows = gsecResult.data || [];
  const tbillRows = tbillResult.data || [];
  const buybackRows = buybackResult.data || [];
  const repoRows = repoResult.data || [];

  const gsecClean = sumField(gsecRows, 'clean_price_amount');
  const gsecDirty = sumField(gsecRows, 'dirty_price_amount');
  const gsecAccruedAtPurchase = gsecDirty - gsecClean;
  const gsecAccrual = sumField(gsecRows, 'cumulative_accrual');
  const gsecAmort = sumField(gsecRows, 'cumulative_amortization');

  const tbillSettlement = sumField(tbillRows, 'settlement_amount');
  const tbillAccrual = sumField(tbillRows, 'accrued_interest_to_date');

  const { cleanTotal: bbClean, accruedAtPurchase: bbAccruedAtPurchase } =
    sumBuySellBuybackHoldings(buybackRows);

  const repo = sumRepoFigures(repoRows, asAtDate);

  const figures = {
    // GSec holdings
    '131-101-350-098-44': gsecClean,
    '131-101-350-128-44': gsecAccruedAtPurchase,
    '131-101-290-218-44': gsecAccrual,
    '131-101-350-134-44': gsecAmort,
    '131-101-170-044-44': gsecAmort,
    // Old amortised-cost code (renamed); same report figure
    '111-101-170-044-44': gsecAmort,

    // T-Bill holdings
    '131-101-350-104-44': tbillSettlement,
    '131-101-350-122-44': tbillAccrual,

    // P&L companions (same magnitude as matching asset stock)
    '467-101-190-470-44': gsecAccrual,
    '358-101-130-416-44': gsecAmort,
    '467-101-190-482-44': tbillAccrual,

    // Buy/Sell buyback holdings
    '131-101-350-204-44': bbClean,
    '131-101-350-208-44': bbAccruedAtPurchase,
    '131-101-290-216-44': buySellAccrualAmort.accrual,
    '131-101-170-050-44': buySellAccrualAmort.amort,
    '358-101-130-428-44': buySellAccrualAmort.amort,
    '467-101-190-488-44': buySellAccrualAmort.accrual,

    // Repo / reverse repo — open Repo + Reverse Repo principal hits liability
    // 249-101-330-308-44 (not the Reverse Repo asset 131-101-410-206-44).
    // Credit-normal liability GLs: store As per Report as negative so
    // Difference = Combined net (−CR) − report (−CR) is zero when they match.
    // After the Repo/Reverse Repo label swap: Repo = borrowing (payable on
    // 780), Reverse Repo = lending (314 companion figure).
    '249-101-330-308-44': -(repo.repoPrincipal + repo.reverseRepoPrincipal),
    '249-101-330-314-44': -repo.reverseRepoInterestPayable,
    '249-101-330-780-44': -repo.repoInterestPayable
  };

  return { asAtDate, figures };
}

module.exports = {
  getAccountReportFigures,
  parseNum,
  sumField,
  sumBuySellBuybackHoldings,
  sumRepoFigures
};
