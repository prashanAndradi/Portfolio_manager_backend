'use strict';

/**
 * Which leg-1 dirty price a premature maturity should grow by the financing rate.
 *
 * leg1_dirty_price and leg1_settlement_amount can disagree. On BB20261016001 the
 * stored accrual was three days short - accrual to the trade date rather than the
 * value date - so the price read 101.2591 against a cash-implied 101.3495, and
 * growing the stored price carried that error straight into leg 2.
 *
 * Where the two disagree, leg 1 is repriced from its own yield at its own value
 * date and the side the repricing matches wins. That is a third, independent
 * source rather than a preference: either the price is stale (trust the cash) or
 * the settlement amount is wrong (trust the price).
 *
 * When the repricing matches neither - BB20260812002 sits about 12 per 100 away
 * from both - nothing here can resolve it, so the stored price stands. That is
 * what keeps a same-day premature maturity a genuine no-op on those deals.
 */

const DEFAULT_TOLERANCE_PER_100 = 0.01;

// Number(null) is 0 and Number('') is 0, either of which would read as a real
// price 0.01 away from nothing and send a missing figure into the comparison.
const num = (v) => {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * @param {object} input
 * @param {number|null} input.storedDirty   - leg1_dirty_price
 * @param {number|null} input.cashDirty     - leg1_settlement_amount / face x 100
 * @param {number|null} input.repricedDirty - leg 1 repriced at its own yield, or null
 * @param {number} [input.tolerance]        - per-100 disagreement that matters
 * @returns {{ dirty: number|null, source: string, disagreed: boolean }}
 *   `dirty` is null when there is no usable leg-1 price at all, which leaves the
 *   caller to fall back to deriving the leg-2 price from the leg-2 cash.
 */
function resolveLeg1BaseDirty({ storedDirty, cashDirty, repricedDirty, tolerance } = {}) {
  const tol = Number.isFinite(tolerance) ? tolerance : DEFAULT_TOLERANCE_PER_100;
  const stored = num(storedDirty);
  const cash = num(cashDirty);
  const repriced = num(repricedDirty);

  if (!Number.isFinite(stored) || stored <= 0) {
    return { dirty: null, source: 'no usable leg-1 price', disagreed: false };
  }
  if (!Number.isFinite(cash)) {
    return { dirty: stored, source: 'stored leg-1 price (no leg-1 cash to compare)', disagreed: false };
  }
  if (Math.abs(cash - stored) <= tol) {
    return { dirty: stored, source: 'stored leg-1 price', disagreed: false };
  }

  const matchesCash = Number.isFinite(repriced) && Math.abs(repriced - cash) <= tol;
  const matchesPrice = Number.isFinite(repriced) && Math.abs(repriced - stored) <= tol;

  if (matchesCash && !matchesPrice) {
    return {
      dirty: cash,
      source: 'leg-1 cash (stored price is stale; repricing agrees with the cash)',
      disagreed: true
    };
  }
  if (matchesPrice && !matchesCash) {
    return {
      dirty: stored,
      source: 'stored leg-1 price (settlement amount is wrong; repricing agrees with the price)',
      disagreed: true
    };
  }
  return {
    dirty: stored,
    source: Number.isFinite(repriced)
      ? 'stored leg-1 price (repricing resolves nothing - leg-1 capture needs review)'
      : 'stored leg-1 price (could not reprice leg 1 - leg-1 capture needs review)',
    disagreed: true
  };
}

module.exports = { resolveLeg1BaseDirty, DEFAULT_TOLERANCE_PER_100 };
