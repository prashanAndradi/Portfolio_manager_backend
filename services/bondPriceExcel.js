'use strict';

/**
 * Excel-compatible PRICE(), used for the "pull to par" amortisation basis that
 * Finance requires:
 *
 *   Daily amortisation = FV x ( PRICE(t) - PRICE(t-1) ) / 100
 *
 * where both prices are struck at the deal's ORIGINAL purchase yield, so the only
 * thing moving between the two days is the passage of time - the bond pulling to
 * par. Mirrors Excel's PRICE(settlement, maturity, rate, yld, redemption,
 * frequency, basis) with frequency 2 (semi-annual) and basis 1 (actual/actual),
 * which is the form used in Finance's own workbook.
 *
 * IMPORTANT - precision: a day's pull to par is only ~0.001-0.002 per 100. Every
 * price the rest of the system exposes is truncated to 4 decimals, which would
 * quantise the difference into meaningless steps. Nothing here rounds; callers
 * round only at the very end.
 */

const MS_PER_DAY = 86400000;

function toUtcDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return isNaN(dt.getTime()) ? null : dt;
}

const dayDiff = (a, b) => Math.round((a - b) / MS_PER_DAY);

/**
 * Step back `months` from a date, keeping the day of month but clamping to the
 * end of the target month. Plain Date arithmetic overflows instead (31 Aug minus
 * 6 months would land on 3 March), which shifts the coupon schedule and throws
 * the price off in exactly the way that matters here.
 */
function addMonths(date, months) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const d = date.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, lastDay)));
}

/**
 * Coupon dates strictly after settlement, earliest first, walking back from
 * maturity. Also returns the coupon date on or before settlement (pcd).
 */
function couponSchedule(settlement, maturity, frequency) {
  const step = 12 / frequency;
  const future = [];
  let d = maturity;
  while (d > settlement) {
    future.push(d);
    d = addMonths(d, -step);
  }
  future.reverse();
  return { pcd: d, ncd: future[0], future };
}

/**
 * Clean price per 100 of redemption value. Returns null when the inputs cannot
 * produce a price (settlement on/after maturity, missing or non-finite inputs).
 */
function excelPrice({ settlement, maturity, rate, yld, redemption = 100, frequency = 2 }) {
  const s = toUtcDate(settlement);
  const m = toUtcDate(maturity);
  const r = Number(rate);
  const y = Number(yld);
  if (!s || !m || m <= s) return null;
  if (!Number.isFinite(r) || !Number.isFinite(y) || r < 0) return null;
  // A zero yield would make the discount factor 1 for every period; still well
  // defined, but a negative one is not meaningful for these instruments.
  if (y < 0) return null;

  const { pcd, ncd, future } = couponSchedule(s, m, frequency);
  const N = future.length;
  if (!N || !ncd) return null;

  const E = dayDiff(ncd, pcd);
  if (!E) return null;
  const DSC = dayDiff(ncd, s);
  const A = dayDiff(s, pcd);

  const coupon = (redemption * r) / frequency;
  const per = y / frequency;

  // One coupon period or less to redemption: Excel switches to SIMPLE discounting
  // rather than compounding. Without this branch every bond in its final six
  // months is mispriced - which is precisely the range where the pull to par is
  // largest, so it matters most here.
  if (N === 1) {
    const DSR = dayDiff(m, s);
    return (redemption + coupon) / (1 + (DSR / E) * per) - coupon * (A / E);
  }

  let price = redemption / Math.pow(1 + per, N - 1 + DSC / E);
  for (let k = 1; k <= N; k++) {
    price += coupon / Math.pow(1 + per, k - 1 + DSC / E);
  }
  return price - coupon * (A / E);
}

/**
 * One day's pull-to-par amortisation for a holding.
 *
 * `faceValue` is the face still held - amortisation applies to the position you
 * actually hold, not the original ticket size.
 *
 * Returns { ok, dailyAmount, scenario, priceToday, pricePrevious }. `dailyAmount`
 * is unsigned and `scenario` carries the direction, matching the shape the ledger
 * posting already expects: a premium bond pulls DOWN to par (price falls) and a
 * discount bond pulls UP.
 */
function computePullToParAmortization({ faceValue, maturity, couponRate, purchaseYield, onDate, frequency = 2 }) {
  const face = Number(faceValue);
  if (!Number.isFinite(face) || face <= 0) return { ok: false, reason: 'no face value' };

  const today = toUtcDate(onDate);
  if (!today) return { ok: false, reason: 'invalid date' };
  const previous = new Date(today.getTime() - MS_PER_DAY);

  const args = { maturity, rate: Number(couponRate) / 100, yld: Number(purchaseYield) / 100, frequency };
  const p1 = excelPrice({ ...args, settlement: previous });
  const p0 = excelPrice({ ...args, settlement: today });
  if (p0 === null || p1 === null) return { ok: false, reason: 'not priceable on these dates' };

  const delta = (face * (p0 - p1)) / 100;
  if (!Number.isFinite(delta)) return { ok: false, reason: 'price difference not finite' };

  return {
    ok: true,
    dailyAmount: Math.abs(delta),
    scenario: delta < 0 ? 'premium' : 'discount',
    signedAmount: delta,
    priceToday: p0,
    pricePrevious: p1
  };
}

/**
 * Amortisation from purchase to `onDate`: FV x (PRICE(onDate) - purchase clean
 * price) / 100. The dailies telescope into this, so the two always agree.
 */
function computePullToParCumulative({ faceValue, maturity, couponRate, purchaseYield, purchaseCleanPrice, onDate, frequency = 2 }) {
  const face = Number(faceValue);
  const purchase = Number(purchaseCleanPrice);
  if (!Number.isFinite(face) || face <= 0) return { ok: false, reason: 'no face value' };
  if (!Number.isFinite(purchase)) return { ok: false, reason: 'no purchase clean price' };

  const price = excelPrice({
    settlement: onDate,
    maturity,
    rate: Number(couponRate) / 100,
    yld: Number(purchaseYield) / 100,
    frequency
  });
  if (price === null) return { ok: false, reason: 'not priceable on this date' };

  const amount = (face * (price - purchase)) / 100;
  return { ok: true, amount, price };
}

module.exports = { excelPrice, computePullToParAmortization, computePullToParCumulative };
