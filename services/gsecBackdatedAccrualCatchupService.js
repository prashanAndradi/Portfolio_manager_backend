'use strict';

/**
 * When a GSec Buy is finally approved with a value_date that is already behind the
 * system day (e.g. trade_date/created 01-Oct, value_date backdated to 30-Sep), the
 * nightly EOD job cannot retroactively post the days it missed - EOD only ever posts
 * one "GSec Daily Accrual for Deal X" row for *today's* system day, each time it runs.
 * A deal that didn't exist yet when EOD ran for 30-Sep will simply never get that
 * day's accrual from EOD, leaving a permanent gap between value_date and the date the
 * deal was actually created/approved.
 *
 * This service closes that gap once, right after final approval: it walks every
 * calendar day from value_date through the current system day and posts the same
 * "GSec Daily Accrual for Deal X" ledger entry EOD would have posted on each of those
 * days, using the same formula and the same (date, description) de-dupe EOD itself
 * relies on - so re-running this, or a later EOD run for today, never double-posts.
 */

const db = require('../config/database');
const { getSystemDay } = require('../models/systemDayModel');
const accountMapping = require('./accountMappingService');
const {
  computeGsecPerDayAccrual,
  computeGsecDailyAmortization,
  resolveGsecRemainingForDailyPosting
} = require('./gsecCouponPeriod');
const { buildSoldByDealMap } = require('./gsecSellDeductionService');

async function resolveAccountIdByCode(accountCode) {
  const [rows] = await db.query(
    'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [accountCode]
  );
  if (!rows || rows.length === 0) {
    throw new Error(`Account code not found in chart_of_accounts: ${accountCode}`);
  }
  return rows[0].id;
}

function ymdDateOnly(value) {
  if (value == null) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of calendar-day YYYY-MM-DD strings from `from` through `to`. */
function enumerateDays(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const days = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 24 * 60 * 60 * 1000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Post catch-up daily accrual entries for one just-finally-approved GSec Buy deal,
 * covering every day from its value_date through today's system day that EOD could
 * not have posted because the deal did not exist yet. No-op (returns skipped) when
 * the deal is not backdated relative to the current system day.
 *
 * @param {object} transaction - full gsec row for the just-approved Buy (needs
 *   id, deal_number, value_date, maturity_date, face_value, remaining_face_value,
 *   coupon_interest, coupon_rate, isin_number).
 */
async function postBackdatedAccrualCatchup(transaction) {
  if (!transaction || transaction.transaction_type !== 'Buy') {
    return { skipped: true, reason: 'not a Buy deal' };
  }

  const systemDayRow = await getSystemDay();
  const systemDay = systemDayRow && systemDayRow.system_date;
  const valueDate = ymdDateOnly(transaction.value_date);
  const today = ymdDateOnly(systemDay);
  if (!valueDate || !today) {
    return { skipped: true, reason: 'missing value_date or system day' };
  }
  if (valueDate >= today) {
    return { skipped: true, reason: 'not backdated' };
  }

  const maturityDate = ymdDateOnly(transaction.maturity_date);
  if (maturityDate && maturityDate <= valueDate) {
    return { skipped: true, reason: 'already matured at value date' };
  }

  const dealNumber = String(transaction.deal_number || '').trim();
  if (!dealNumber) {
    return { skipped: true, reason: 'missing deal_number' };
  }

  let gsecDrAccountId;
  let gsecCrAccountId;
  try {
    const [gsecDrAccountCode, gsecCrAccountCode] = await Promise.all([
      accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_ASSET),
      accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_INCOME)
    ]);
    [gsecDrAccountId, gsecCrAccountId] = await Promise.all([
      resolveAccountIdByCode(gsecDrAccountCode),
      resolveAccountIdByCode(gsecCrAccountCode)
    ]);
  } catch (mapErr) {
    console.error('Backdated accrual catch-up: GSec accrual account mapping unavailable, skipping:', mapErr.message);
    return { skipped: true, reason: 'account mapping unavailable' };
  }

  // Stop at maturity - the day's own accrual ends there, same cutoff EOD applies.
  const lastDay = maturityDate && maturityDate < today ? maturityDate : today;
  const days = enumerateDays(valueDate, lastDay).filter((d) => !maturityDate || d < maturityDate);
  if (!days.length) {
    return { skipped: true, reason: 'no catch-up days in range' };
  }

  const description = `GSec Daily Accrual for Deal ${dealNumber}`;
  const [alreadyPostedRows] = await db.query(
    `SELECT DISTINCT DATE(entry_date) AS d FROM ledger_entries WHERE deal_number = ? AND description = ?`,
    [dealNumber, description]
  );
  const alreadyPosted = new Set((alreadyPostedRows || []).map((r) => ymdDateOnly(r.d)));

  let posted = 0;
  let skippedAlreadyPosted = 0;
  let lastComputed = null;

  for (const day of days) {
    if (alreadyPosted.has(day)) {
      skippedAlreadyPosted++;
      continue;
    }
    // Must be resolved per day, not once for the whole range: a sell linked to this
    // Buy may have a value date that falls partway through the catch-up window (e.g.
    // value_date 30-Sep, sold the next day on 01-Oct) - treating it as sold on every
    // day in the range would wrongly zero out the days before its own value date.
    //
    // A linked Sell writes gsec.remaining_face_value down the moment IT is approved,
    // even if its own value date is still ahead of `day` - same as live EOD, that
    // not-yet-effective reduction must be added back via pending_sold_face_value so
    // the lot still accrues on the days before the sale's value date actually arrives.
    const [soldByDealForDay, soldByDealEver] = await Promise.all([
      buildSoldByDealMap(db, [dealNumber], day),
      buildSoldByDealMap(db, [dealNumber], null)
    ]);
    const linkedSoldForDay = Number(soldByDealForDay[dealNumber] || 0);
    const pendingSoldForDay = Math.max(0, Number(soldByDealEver[dealNumber] || 0) - linkedSoldForDay);
    const dealWithSold = Object.assign({}, transaction, { linked_sold_face_value: linkedSoldForDay });
    const effectiveRemaining = resolveGsecRemainingForDailyPosting(dealWithSold, {
      linked_buyback_face_value: 0,
      pending_buyback_face_value: 0,
      pending_sold_face_value: pendingSoldForDay
    });
    const dealForAccrual = Object.assign({}, dealWithSold, {
      remaining_face_value: effectiveRemaining
    });
    const computed = computeGsecPerDayAccrual(dealForAccrual, day, 2);
    if (!computed.ok) {
      console.warn('Backdated accrual catch-up: skipping day', day, 'for', dealNumber, computed.reason);
      continue;
    }
    const { amount, E } = computed;
    await db.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
      [day, gsecDrAccountId, amount, dealNumber, description, 'LKR']
    );
    await db.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, 0, ?, ?, ?, ?)`,
      [day, gsecCrAccountId, amount, dealNumber, description, 'LKR']
    );
    posted++;
    lastComputed = { amount, E };
  }

  if (lastComputed) {
    await db.query(
      `UPDATE gsec SET per_day_accrual = ?, number_of_days_for_coupon_period = ? WHERE id = ?`,
      [lastComputed.amount, lastComputed.E, transaction.id]
    );
  }

  return {
    skipped: false,
    deal_number: dealNumber,
    value_date: valueDate,
    system_day: today,
    days_in_range: days.length,
    posted,
    skipped_already_posted: skippedAlreadyPosted
  };
}

/**
 * Same gap as postBackdatedAccrualCatchup, but for the straight-line premium/discount
 * amortization leg ("GSec Daily Amortization for Deal X"). EOD posts these side by
 * side with the accrual entries, keyed the same way, so a backdated Buy with a
 * non-par clean price has an identical missing-days problem on this leg too.
 *
 * Unlike accrual, the daily amortization amount is a straight-line constant for the
 * deal's whole life (face/clean-price/value-to-maturity days), so it does not need to
 * be recomputed per day the way the accrual's coupon-period E does - only the
 * remaining face (sold/pending-sold) can change it day to day.
 */
async function postBackdatedAmortizationCatchup(transaction) {
  if (!transaction || transaction.transaction_type !== 'Buy') {
    return { skipped: true, reason: 'not a Buy deal' };
  }

  const systemDayRow = await getSystemDay();
  const systemDay = systemDayRow && systemDayRow.system_date;
  const valueDate = ymdDateOnly(transaction.value_date);
  const today = ymdDateOnly(systemDay);
  if (!valueDate || !today) {
    return { skipped: true, reason: 'missing value_date or system day' };
  }
  if (valueDate >= today) {
    return { skipped: true, reason: 'not backdated' };
  }

  const maturityDate = ymdDateOnly(transaction.maturity_date);
  if (maturityDate && maturityDate <= valueDate) {
    return { skipped: true, reason: 'already matured at value date' };
  }

  const dealNumber = String(transaction.deal_number || '').trim();
  if (!dealNumber) {
    return { skipped: true, reason: 'missing deal_number' };
  }

  const clean = Number(transaction.clean_price);
  if (!Number.isFinite(clean) || Math.abs(clean - 100) < 1e-6) {
    // Par bond, or no clean_price on the deal row - nothing to amortize, same as EOD.
    return { skipped: true, reason: 'par bond or missing clean_price' };
  }

  let amortTradingAccountId;
  let amortFaAccountId;
  try {
    const [amortTradingCode, amortFaCode] = await Promise.all([
      accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_AMORTISATION_TRADING),
      accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_FINANCIAL_ASSETS_AMORTISED_COST)
    ]);
    [amortTradingAccountId, amortFaAccountId] = await Promise.all([
      resolveAccountIdByCode(amortTradingCode),
      resolveAccountIdByCode(amortFaCode)
    ]);
  } catch (mapErr) {
    console.error('Backdated amortization catch-up: GSec amortization account mapping unavailable, skipping:', mapErr.message);
    return { skipped: true, reason: 'account mapping unavailable' };
  }

  let hasPerDayAmortizationColumn = false;
  try {
    const [colRows] = await db.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gsec' AND COLUMN_NAME = 'per_day_amortization'
       LIMIT 1`
    );
    hasPerDayAmortizationColumn = Array.isArray(colRows) && colRows.length > 0;
  } catch (_) { /* leave false */ }

  const lastDay = maturityDate && maturityDate < today ? maturityDate : today;
  const days = enumerateDays(valueDate, lastDay).filter((d) => !maturityDate || d < maturityDate);
  if (!days.length) {
    return { skipped: true, reason: 'no catch-up days in range' };
  }

  const description = `GSec Daily Amortization for Deal ${dealNumber}`;
  const [alreadyPostedRows] = await db.query(
    `SELECT DISTINCT DATE(entry_date) AS d FROM ledger_entries WHERE deal_number = ? AND description = ?`,
    [dealNumber, description]
  );
  const alreadyPosted = new Set((alreadyPostedRows || []).map((r) => ymdDateOnly(r.d)));

  let posted = 0;
  let skippedAlreadyPosted = 0;
  let lastDailyAmount = null;

  for (const day of days) {
    const [soldByDealForDay, soldByDealEver] = await Promise.all([
      buildSoldByDealMap(db, [dealNumber], day),
      buildSoldByDealMap(db, [dealNumber], null)
    ]);
    const linkedSoldForDay = Number(soldByDealForDay[dealNumber] || 0);
    const pendingSoldForDay = Math.max(0, Number(soldByDealEver[dealNumber] || 0) - linkedSoldForDay);
    const dealWithSold = Object.assign({}, transaction, { linked_sold_face_value: linkedSoldForDay });
    const effectiveRemaining = resolveGsecRemainingForDailyPosting(dealWithSold, {
      linked_buyback_face_value: 0,
      pending_buyback_face_value: 0,
      pending_sold_face_value: pendingSoldForDay
    });
    if (effectiveRemaining <= 0) {
      continue;
    }
    const dealForAmort = Object.assign({}, dealWithSold, { remaining_face_value: effectiveRemaining });
    const computed = computeGsecDailyAmortization(dealForAmort, day);
    if (!computed.ok) {
      console.warn('Backdated amortization catch-up: skipping day', day, 'for', dealNumber, computed.reason);
      continue;
    }
    const { dailyAmount, scenario } = computed;
    lastDailyAmount = dailyAmount;

    if (alreadyPosted.has(day)) {
      skippedAlreadyPosted++;
      continue;
    }

    const drId = scenario === 'premium' ? amortTradingAccountId : amortFaAccountId;
    const crId = scenario === 'premium' ? amortFaAccountId : amortTradingAccountId;
    await db.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
      [day, drId, dailyAmount, dealNumber, description, 'LKR']
    );
    await db.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, 0, ?, ?, ?, ?)`,
      [day, crId, dailyAmount, dealNumber, description, 'LKR']
    );
    posted++;
  }

  if (hasPerDayAmortizationColumn && lastDailyAmount != null) {
    await db.query('UPDATE gsec SET per_day_amortization = ? WHERE id = ?', [lastDailyAmount, transaction.id]);
  }

  return {
    skipped: false,
    deal_number: dealNumber,
    value_date: valueDate,
    system_day: today,
    days_in_range: days.length,
    posted,
    skipped_already_posted: skippedAlreadyPosted
  };
}

module.exports = { postBackdatedAccrualCatchup, postBackdatedAmortizationCatchup };
