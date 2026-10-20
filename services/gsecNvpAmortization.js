'use strict';

/**
 * Daily amortisation on the NVP basis that Finance reconciles to:
 *
 *   Daily Amortisation = Balance x ( NVP(today) - NVP(previous day) ) / 100
 *
 * where both NVPs are struck at the deal's ORIGINAL purchase yield, so the only
 * thing moving between the two days is the passage of time - the bond pulling
 * to par - and both are ROUNDED to 4 decimals, matching the NVP column on the
 * GSec report. Finance's worked example:
 *
 *   1,353,999 x (99.8936 - 99.8922) / 100 = 18.96   (deal 20240315/GSEC/0001)
 *
 * Two deliberate choices, both of which change the answer:
 *
 *  - ROUNDED, not truncated. `calculateNVP` used to truncate; truncation puts
 *    15-Oct at 99.8921 instead of 99.8922, which turns 18.96 into 20.31.
 *
 *  - 4 decimals, not full precision. A day's pull to par on this bond is only
 *    ~0.0015 per 100, so the 4th decimal is the whole signal: the daily figure
 *    moves in steps of about 1.35 and will not be smooth day to day. It
 *    telescopes correctly - the steps always sum to the change in the rounded
 *    price - so a month totals correctly even though single days vary. This is
 *    the agreed basis; see the note in computeNvpDailyAmortization.
 *
 * The balance used is the REMAINING balance, not the original ticket size.
 */

const { calculateNVP } = require('../utils/bondPricingNVP');

const MS_PER_DAY = 86400000;

function toUtc(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

const ymd = (d) => d.toISOString().slice(0, 10);

/**
 * NVP for one date, rounded to 4dp, exactly as the GSec report shows it.
 * Returns null when the inputs cannot produce a price.
 */
function nvpOn(deal, dateYmd) {
  const res = calculateNVP({
    faceValue: deal.face_value,
    couponRate: deal.coupon_rate,
    yieldRate: deal.yield,
    systemDate: dateYmd,
    maturityDate: deal.maturity_date,
    issueDate: deal.issue_date,
    couponDate1: deal.coupon_date_1,
    couponDate2: deal.coupon_date_2,
    quiet: true
  });
  if (!res || res.nvp === '' || res.nvp === null || res.nvp === undefined) return null;
  const n = Number(res.nvp);
  return Number.isFinite(n) ? n : null;
}

/**
 * One day's amortisation for a holding.
 *
 * Fails loudly rather than silently returning zero: a missing yield or coupon
 * rate means the deal CANNOT be amortised on this basis, and posting 0 would
 * look like a correctly-amortised par bond. The caller is expected to surface
 * `reason`, not swallow it.
 *
 * @param {object} deal  face_value, remaining_face_value, coupon_rate, yield,
 *                       maturity_date, issue_date, coupon_date_1, coupon_date_2
 * @param {string|Date} onDate  the day being posted
 * @param {object} [options]
 * @param {number} [options.remainingOverride]  balance to use instead of the
 *        deal's own remaining_face_value (EOD resolves this from linked sells
 *        and buybacks)
 */
function computeNvpDailyAmortization(deal, onDate, options = {}) {
  const missing = [];
  if (deal.coupon_rate === null || deal.coupon_rate === undefined || deal.coupon_rate === '') missing.push('coupon_rate');
  if (deal.yield === null || deal.yield === undefined || deal.yield === '') missing.push('yield');
  if (!deal.maturity_date) missing.push('maturity_date');
  if (!deal.issue_date) missing.push('issue_date');
  if (!deal.coupon_date_1) missing.push('coupon_date_1');
  if (!deal.coupon_date_2) missing.push('coupon_date_2');
  if (missing.length) {
    return { ok: false, reason: `cannot amortise on the NVP basis, missing: ${missing.join(', ')}` };
  }

  const today = toUtc(onDate);
  if (!today) return { ok: false, reason: `invalid date ${onDate}` };
  const previous = new Date(today.getTime() - MS_PER_DAY);

  const maturity = toUtc(deal.maturity_date);
  if (maturity && today > maturity) {
    return { ok: false, reason: 'past maturity' };
  }

  let remaining =
    options.remainingOverride !== undefined && options.remainingOverride !== null
      ? Number(options.remainingOverride)
      : Number(
          deal.remaining_face_value === null ||
            deal.remaining_face_value === undefined ||
            deal.remaining_face_value === ''
            ? deal.face_value
            : deal.remaining_face_value
        );
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return { ok: false, reason: 'no remaining balance' };
  }

  const nvpToday = nvpOn(deal, ymd(today));
  const nvpPrev = nvpOn(deal, ymd(previous));
  if (nvpToday === null || nvpPrev === null) {
    return { ok: false, reason: 'not priceable on these dates' };
  }

  const delta = nvpToday - nvpPrev;
  const signed = (remaining * delta) / 100;
  if (!Number.isFinite(signed)) {
    return { ok: false, reason: 'price difference not finite' };
  }

  // `dailyAmount` is unsigned and `scenario` carries the direction, matching
  // the shape the ledger posting already expects: a discount bond pulls UP to
  // par (price rises, delta positive), a premium bond pulls DOWN.
  return {
    ok: true,
    dailyAmount: Math.abs(signed),
    signedAmount: signed,
    scenario: delta < 0 ? 'premium' : 'discount',
    nvpToday,
    nvpPrevious: nvpPrev,
    delta,
    remaining,
    basis: 'nvp-4dp'
  };
}

module.exports = { computeNvpDailyAmortization, nvpOn };
