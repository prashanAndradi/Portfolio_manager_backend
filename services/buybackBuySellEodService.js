'use strict';

/**
 * Daily accrual + amortization EOD for Buy/Sell buybacks (leg1 Buy only).
 *
 * - Ledger deal_number: {buyback}/BB-L1/BUY
 * - Face: fixed leg1_adjusted_face_value (fallback leg1_face_value)
 * - Maturity for coupon/amort schedule: leg2_value_date
 * - Active while leg1 buy is posted, leg2 sell is not, and systemDay < leg2_value_date
 */

const db = require('../config/database');
const { computeGsecPerDayAccrual } = require('./gsecCouponPeriod');
const { computeNvpDailyAmortization } = require('./gsecNvpAmortization');
const {
  BUYSELL_ACCRUAL_ASSET,
  BUYSELL_ACCRUAL_INCOME,
  BUYSELL_AMORT_FA,
  BUYSELL_AMORT_REVENUE,
  syntheticLeg1BuyDealNumber,
  syntheticLeg2SellDealNumber,
  valueDateOnOrBeforeSystemDay,
} = require('./buybackBuySellLedgerService');

const ACCRUAL_DESC_PREFIX = 'Buy/Sell Buyback Daily Accrual for Deal ';
const AMORT_DESC_PREFIX = 'Buy/Sell Buyback Daily Amortization for Deal ';

function utcDayMs(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return NaN;
  return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
}

function isStrictlyBeforeUtcDay(a, b) {
  const am = utcDayMs(a);
  const bm = utcDayMs(b);
  if (!Number.isFinite(am) || !Number.isFinite(bm)) return false;
  return am < bm;
}

function legFace(adjusted, base) {
  const v = adjusted !== null && adjusted !== undefined ? adjusted : base;
  return parseFloat(v) || 0;
}

async function resolveAccountIdByCode(accountCode) {
  const [rows] = await db.query(
    'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [accountCode]
  );
  if (!rows?.length) {
    throw new Error(`Account code not found: ${accountCode}`);
  }
  return rows[0].id;
}

async function postPair({ date, drAccountId, crAccountId, amount, dealId, description }) {
  await db.query(
    `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
     VALUES (?, ?, ?, 0, ?, ?, 'LKR')`,
    [date, drAccountId, amount, String(dealId), description]
  );
  await db.query(
    `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
     VALUES (?, ?, 0, ?, ?, ?, 'LKR')`,
    [date, crAccountId, amount, String(dealId), description]
  );
  return { success: true };
}

async function leg1BuyLedgerPosted(syntheticDealNumber) {
  const [rows] = await db.query(
    `SELECT 1 FROM ledger_entries
     WHERE deal_number = ?
       AND description LIKE '%GSec Purchase%'
     LIMIT 1`,
    [syntheticDealNumber]
  );
  return rows.length > 0;
}

async function leg2SellLedgerPosted(bb) {
  const synthetic = syntheticLeg2SellDealNumber(bb.deal_number);
  const [rows] = await db.query(
    'SELECT 1 FROM ledger_entries WHERE deal_number = ? LIMIT 1',
    [synthetic]
  );
  return rows.length > 0;
}

async function enrichIsin(bb) {
  let isin = {};
  if (!bb.leg1_isin) return isin;
  try {
    const [rows] = await db.query(
      'SELECT issue_date, maturity_date, coupon_rate, coupon_date_1, coupon_date_2 FROM isin_master WHERE isin_number = ? LIMIT 1',
      [bb.leg1_isin]
    );
    if (rows?.[0]) isin = rows[0];
  } catch (e) {
    console.warn(`buybackBuySellEod: ISIN lookup failed for ${bb.leg1_isin}:`, e.message);
  }
  return isin;
}

/**
 * Context for pricing the buy leg on the NVP amortisation basis.
 *
 * Deliberately NOT buildBuyLegDealContext: that one sets `maturity_date` to the
 * leg2 value date, which is the right end point for a straight-line accrual
 * over the holding period but wrong for pricing. NVP values the underlying
 * BOND, so it needs the bond's real maturity and coupon schedule - leg2 is
 * typically years earlier (e.g. leg2 2026-05-04 against a 2032-10-01 bond), and
 * pricing to it would value a security that does not exist.
 *
 * The holding window is still respected: EOD only posts between leg1 and leg2
 * value dates, so the days priced are exactly the days held.
 */
function buildBuyLegPricingContext(bb, isin) {
  const face = legFace(bb.leg1_adjusted_face_value, bb.leg1_face_value);
  return {
    face_value: face,
    remaining_face_value: face,
    clean_price: bb.leg1_clean_price,
    value_date: bb.leg1_value_date,
    // The bond's own maturity, never leg2_value_date.
    maturity_date: bb.maturity_date || isin.maturity_date,
    issue_date: bb.issue_date || isin.issue_date,
    yield: bb.leg1_yield_rate,
    coupon_rate: bb.coupon_rate ?? isin.coupon_rate,
    isin_number: bb.leg1_isin,
    coupon_date_1: bb.coupon_date1 || isin.coupon_date_1,
    coupon_date_2: bb.coupon_date2 || isin.coupon_date_2
  };
}

function buildBuyLegDealContext(bb, isin) {
  const face = legFace(bb.leg1_adjusted_face_value, bb.leg1_face_value);
  const maturity = bb.leg2_value_date || bb.maturity_date || isin.maturity_date;
  const couponRate = parseFloat(bb.coupon_rate ?? isin.coupon_rate ?? 0) || 0;

  return {
    face_value: face,
    remaining_face_value: face,
    clean_price: bb.leg1_clean_price,
    value_date: bb.leg1_value_date,
    maturity_date: maturity,
    coupon_rate: couponRate,
    coupon_interest: null,
    isin_number: bb.leg1_isin,
    coupon_date_1: bb.coupon_date1 || isin.coupon_date_1,
    coupon_date_2: bb.coupon_date2 || isin.coupon_date_2,
  };
}

async function loadEligibleBuybacks(systemDay) {
  const [rows] = await db.query(
    `SELECT * FROM buyback_deals
     WHERE deal_status = 'Approved'
       AND leg1_transaction_type = 'Buy'
       AND leg2_transaction_type = 'Sell'
       AND leg1_value_date IS NOT NULL
       AND leg2_value_date IS NOT NULL`
  );

  const eligible = [];
  for (const bb of rows || []) {
    const synthetic = syntheticLeg1BuyDealNumber(bb.deal_number);
    if (!(await leg1BuyLedgerPosted(synthetic))) continue;
    if (await leg2SellLedgerPosted(bb)) continue;
    if (!valueDateOnOrBeforeSystemDay(bb.leg1_value_date, systemDay)) continue;
    if (!isStrictlyBeforeUtcDay(systemDay, bb.leg2_value_date)) continue;
    eligible.push(bb);
  }
  return eligible;
}

async function hasPerDayColumns() {
  const [cols] = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'buyback_deals'
       AND COLUMN_NAME IN ('leg1_per_day_accrual', 'leg1_per_day_amortization')`
  );
  const names = new Set((cols || []).map((r) => r.COLUMN_NAME));
  return {
    accrual: names.has('leg1_per_day_accrual'),
    amort: names.has('leg1_per_day_amortization'),
    couponPeriod: names.has('leg1_number_of_days_for_coupon_period'),
  };
}

/**
 * @param {string|Date} systemDay
 * @returns {Promise<object>}
 */
async function runBuySellDailyAccrualPosting(systemDay) {
  const [alreadyPostedRows] = await db.query(
    `SELECT DISTINCT deal_number FROM ledger_entries
     WHERE DATE(entry_date) = DATE(?)
       AND description LIKE ?`,
    [systemDay, `${ACCRUAL_DESC_PREFIX}%`]
  );
  const alreadyPosted = new Set((alreadyPostedRows || []).map((r) => String(r.deal_number)));

  const accrualAssetId = await resolveAccountIdByCode(BUYSELL_ACCRUAL_ASSET);
  const accrualIncomeId = await resolveAccountIdByCode(BUYSELL_ACCRUAL_INCOME);
  const colFlags = await hasPerDayColumns();

  const buybacks = await loadEligibleBuybacks(systemDay);
  let posted = 0;
  let skippedAlreadyPosted = 0;
  let storedValueCorrected = 0;

  for (const bb of buybacks) {
    try {
      const synthetic = syntheticLeg1BuyDealNumber(bb.deal_number);
      const isin = await enrichIsin(bb);
      const dealCtx = buildBuyLegDealContext(bb, isin);
      const computed = computeGsecPerDayAccrual(dealCtx, systemDay, 2);
      if (!computed.ok) {
        console.warn('Buy/Sell accrual skip:', bb.deal_number, computed.reason);
        if (colFlags.accrual && Number(bb.leg1_per_day_accrual) > 0) {
          await db.query(
            'UPDATE buyback_deals SET leg1_per_day_accrual = 0 WHERE id = ?',
            [bb.id]
          );
          storedValueCorrected++;
        }
        continue;
      }

      const { amount, E } = computed;
      if (alreadyPosted.has(synthetic)) {
        skippedAlreadyPosted++;
      } else {
        await postPair({
          date: systemDay,
          drAccountId: accrualAssetId,
          crAccountId: accrualIncomeId,
          amount,
          dealId: synthetic,
          description: `${ACCRUAL_DESC_PREFIX}${synthetic}`,
        });
        alreadyPosted.add(synthetic);
        posted++;
      }

      if (colFlags.accrual) {
        const existing = Number(bb.leg1_per_day_accrual) || 0;
        if (Math.abs(existing - Number(amount)) > 0.00000001) storedValueCorrected++;
        if (colFlags.couponPeriod) {
          await db.query(
            'UPDATE buyback_deals SET leg1_per_day_accrual = ?, leg1_number_of_days_for_coupon_period = ? WHERE id = ?',
            [amount, E, bb.id]
          );
        } else {
          await db.query('UPDATE buyback_deals SET leg1_per_day_accrual = ? WHERE id = ?', [
            amount,
            bb.id,
          ]);
        }
      }
    } catch (err) {
      console.error('Buy/Sell daily accrual failed:', bb.deal_number, err);
    }
  }

  return {
    posted,
    skipped_already_posted: skippedAlreadyPosted,
    stored_value_corrected: storedValueCorrected,
    deals_loaded: buybacks.length,
  };
}

/**
 * @param {string|Date} systemDay
 * @returns {Promise<object>}
 */
async function runBuySellDailyAmortizationPosting(systemDay) {
  const [alreadyPostedRows] = await db.query(
    `SELECT DISTINCT deal_number FROM ledger_entries
     WHERE DATE(entry_date) = DATE(?)
       AND description LIKE ?`,
    [systemDay, `${AMORT_DESC_PREFIX}%`]
  );
  const alreadyPosted = new Set((alreadyPostedRows || []).map((r) => String(r.deal_number)));

  const amortFaId = await resolveAccountIdByCode(BUYSELL_AMORT_FA);
  const amortRevenueId = await resolveAccountIdByCode(BUYSELL_AMORT_REVENUE);
  const colFlags = await hasPerDayColumns();

  const buybacks = await loadEligibleBuybacks(systemDay);
  let posted = 0;
  let skippedAlreadyPosted = 0;

  for (const bb of buybacks) {
    try {
      const synthetic = syntheticLeg1BuyDealNumber(bb.deal_number);
      const isin = await enrichIsin(bb);
      const pricingCtx = buildBuyLegPricingContext(bb, isin);
      // Same NVP basis as the GSec EOD: Balance x (NVP(today) - NVP(yesterday))
      // / 100 at the leg's purchase yield, both rounded to 4dp.
      const computed = computeNvpDailyAmortization(pricingCtx, systemDay);
      if (!computed.ok) {
        console.warn(
          `buybackBuySellEod: amortization skipped for ${bb.deal_number}: ${computed.reason}`
        );
        if (colFlags.amort && bb.leg1_per_day_amortization != null) {
          await db.query('UPDATE buyback_deals SET leg1_per_day_amortization = 0 WHERE id = ?', [
            bb.id,
          ]);
        }
        continue;
      }

      const { dailyAmount, scenario } = computed;

      if (colFlags.amort) {
        await db.query('UPDATE buyback_deals SET leg1_per_day_amortization = ? WHERE id = ?', [
          dailyAmount,
          bb.id,
        ]);
      }

      if (alreadyPosted.has(synthetic)) {
        skippedAlreadyPosted++;
        continue;
      }

      let drId;
      let crId;
      if (scenario === 'premium') {
        drId = amortRevenueId;
        crId = amortFaId;
      } else {
        drId = amortFaId;
        crId = amortRevenueId;
      }

      await postPair({
        date: systemDay,
        drAccountId: drId,
        crAccountId: crId,
        amount: dailyAmount,
        dealId: synthetic,
        description: `${AMORT_DESC_PREFIX}${synthetic}`,
      });
      alreadyPosted.add(synthetic);
      posted++;
    } catch (err) {
      console.error('Buy/Sell daily amortization failed:', bb.deal_number, err);
    }
  }

  return {
    posted,
    skipped_already_posted: skippedAlreadyPosted,
    enabled: true,
    deals_loaded: buybacks.length,
  };
}

module.exports = {
  runBuySellDailyAccrualPosting,
  runBuySellDailyAmortizationPosting,
  buildBuyLegDealContext,
  buildBuyLegPricingContext,
  ACCRUAL_DESC_PREFIX,
  AMORT_DESC_PREFIX,
};
