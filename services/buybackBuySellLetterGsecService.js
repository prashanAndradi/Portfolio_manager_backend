'use strict';

/**
 * Letter-only GSEC rows for Buy/Sell buybacks (leg1 = Buy, leg2 = Sell).
 * Used so settlement instruction letters work from the buyback blotter.
 * Does NOT deduct holdings or post GL — ledger stays in buybackBuySellLedgerService.
 */

const Gsec = require('../models/gsec');
const db = require('../config/database');
const { normalizeUserId } = require('../utils/requestUser');
const {
  getCouponPeriodLengthDaysFromIsinSchedule,
  resolveIsinCouponDates,
  getCouponPeriodEOverride
} = require('./gsecCouponPeriod');
const {
  resolveExternalBuybackCounterpartyId
} = require('./buybackLeg1SellGsecService');

const getLegEffectiveFace = (deal, leg) => {
  const adj = parseFloat(
    leg === 1 ? deal.leg1_adjusted_face_value : deal.leg2_adjusted_face_value
  );
  const face = parseFloat(leg === 1 ? deal.leg1_face_value : deal.leg2_face_value);
  if (Number.isFinite(adj) && adj > 0) return adj;
  if (Number.isFinite(face) && face > 0) return face;
  return 0;
};

async function resolveCouponFields(isinNumber, valueDate, buybackDeal, faceValue) {
  const [isinData] = await db.query('SELECT * FROM isin_master WHERE isin_number = ?', [
    isinNumber
  ]);
  if (!isinData || isinData.length === 0) return null;

  const isin = isinData[0];
  const issueDate = buybackDeal.issue_date || isin.issue_date;
  const maturityDate = buybackDeal.maturity_date || isin.maturity_date;
  const couponDate1 = buybackDeal.coupon_date1 || isin.coupon_date_1;
  const couponDate2 = buybackDeal.coupon_date2 || isin.coupon_date_2;
  const couponRate = buybackDeal.coupon_rate || isin.coupon_rate || 0;
  const couponInterest = (faceValue * parseFloat(couponRate || 0)) / 100 / 2;

  let lastCouponDate = null;
  let nextCouponDate = null;
  let numberOfDaysInterestAccrued = null;
  let numberOfDaysForCouponPeriod = null;

  if (valueDate && maturityDate) {
    try {
      const resolved = resolveIsinCouponDates({
        isin_number: isinNumber,
        coupon_date_1: couponDate1,
        coupon_date_2: couponDate2
      });
      const sched = getCouponPeriodLengthDaysFromIsinSchedule(
        valueDate,
        maturityDate,
        resolved.coupon_date_1,
        resolved.coupon_date_2
      );
      if (sched && sched.E > 0) {
        lastCouponDate = sched.lastCoupon.toISOString().slice(0, 10);
        nextCouponDate = sched.nextCoupon.toISOString().slice(0, 10);
        numberOfDaysForCouponPeriod = sched.E;
        numberOfDaysInterestAccrued = Math.floor(
          (new Date(valueDate) - sched.lastCoupon) / (1000 * 60 * 60 * 24)
        );
      }
    } catch (e) {
      console.warn('Buy/Sell letter GSEC coupon period failed:', e.message);
    }
  }
  const eOverride = getCouponPeriodEOverride(isinNumber);
  if (eOverride) numberOfDaysForCouponPeriod = eOverride;

  return {
    issueDate,
    maturityDate,
    couponDate1,
    couponDate2,
    couponRate,
    couponInterest,
    lastCouponDate,
    nextCouponDate,
    numberOfDaysInterestAccrued,
    numberOfDaysForCouponPeriod
  };
}

async function findExistingLetterGsec(query, buybackIdNum, transactionType) {
  const [rows] = await query(
    `SELECT id, deal_number FROM gsec
     WHERE transaction_type = ?
       AND COALESCE(status, '') <> 'cancelled'
       AND buyback_deal_id = ?
     ORDER BY id ASC
     LIMIT 1`,
    [transactionType, buybackIdNum]
  );
  return rows && rows[0] ? rows[0] : null;
}

/**
 * Create letter-only leg1 Buy for a Buy/Sell buyback.
 * @returns {Promise<number|null>}
 */
async function createBuySellLeg1BuyLetterGsec({
  buybackDeal,
  buybackIdNum,
  hasBuybackDealId,
  connection,
  userId
}) {
  const query = connection ? connection.query.bind(connection) : db.query.bind(db);
  const face = getLegEffectiveFace(buybackDeal, 1);
  if (!(face > 0) || !buybackDeal.leg1_isin) {
    console.warn(
      `Skip Buy/Sell leg1 Buy letter for ${buybackDeal.deal_number}: missing face/ISIN`
    );
    return null;
  }

  if (hasBuybackDealId) {
    const existing = await findExistingLetterGsec(query, buybackIdNum, 'Buy');
    if (existing) {
      console.log(
        `Buy/Sell leg1 Buy letter already exists for ${buybackDeal.deal_number}: ${existing.deal_number}`
      );
      return existing.id;
    }
  }

  const coupon = await resolveCouponFields(
    buybackDeal.leg1_isin,
    buybackDeal.leg1_value_date,
    buybackDeal,
    face
  );
  if (!coupon) {
    console.warn(
      `ISIN not found for Buy/Sell leg1 Buy letter: ${buybackDeal.leg1_isin}`
    );
    return null;
  }

  const externalCounterparty =
    (await resolveExternalBuybackCounterpartyId(buybackDeal)) ||
    buybackDeal.leg1_counterparty ||
    buybackDeal.leg2_counterparty;

  const buyData = {
    tradeType: buybackDeal.leg1_trade_type || 'BuyBack',
    transactionType: 'Buy',
    counterparty: externalCounterparty,
    broker: buybackDeal.leg1_broker || null,
    dealNumber: null,
    isin: buybackDeal.leg1_isin,
    faceValue: face,
    valueDate: buybackDeal.leg1_value_date,
    nextCouponDate: coupon.nextCouponDate,
    lastCouponDate: coupon.lastCouponDate,
    numberOfDaysInterestAccrued: coupon.numberOfDaysInterestAccrued,
    numberOfDaysForCouponPeriod: coupon.numberOfDaysForCouponPeriod,
    accruedInterest: buybackDeal.leg1_accrued_interest || null,
    couponInterest: coupon.couponInterest,
    cleanPrice: buybackDeal.leg1_clean_price,
    dirtyPrice: buybackDeal.leg1_dirty_price,
    accruedInterestCalculation:
      coupon.couponRate != null && Number(coupon.couponRate) > 0
        ? Number(coupon.couponRate) / 2
        : null,
    settlementAmount: buybackDeal.leg1_settlement_amount,
    settlementMode: buybackDeal.leg1_settlement_mode,
    issueDate: coupon.issueDate,
    maturityDate: coupon.maturityDate,
    couponDates:
      coupon.couponDate1 && coupon.couponDate2
        ? `${coupon.couponDate1},${coupon.couponDate2}`
        : `${coupon.couponDate1 || ''},${coupon.couponDate2 || ''}`,
    yield: buybackDeal.leg1_yield_rate,
    brokerage: buybackDeal.leg1_brokerage || 0,
    currency: buybackDeal.leg1_currency || 'LKR',
    portfolio: buybackDeal.leg1_portfolio,
    strategy: buybackDeal.leg1_strategy,
    custodian: buybackDeal.leg1_custodian,
    tradeDate: buybackDeal.leg1_trade_date || buybackDeal.leg1_value_date,
    // Letter-only: zero remaining so it never looks sellable if report filter misses it
    remaining_face_value: 0,
    userId: normalizeUserId(userId),
    current_approval_level: null,
    status: 'final_approved',
    fundMovement: buybackDeal.fund_movement,
    skipCashflowCapture: true
  };

  const result = await Gsec.createWithConnection(buyData, connection || null);
  if (hasBuybackDealId && result?.insertId) {
    await query('UPDATE gsec SET buyback_deal_id = ?, remaining_face_value = 0 WHERE id = ?', [
      buybackIdNum,
      result.insertId
    ]);
  }
  console.log(
    `Created Buy/Sell leg1 Buy letter for ${buybackDeal.deal_number}, gsecId=${result.insertId}`
  );
  return result?.insertId || null;
}

/**
 * Create letter-only leg2 Sell for a Buy/Sell buyback (no buy allocations / no face deduction).
 * @returns {Promise<number|null>}
 */
async function createBuySellLeg2SellLetterGsec({
  buybackDeal,
  buybackIdNum,
  hasBuybackDealId,
  connection,
  userId
}) {
  const query = connection ? connection.query.bind(connection) : db.query.bind(db);
  const face = getLegEffectiveFace(buybackDeal, 2);
  if (!(face > 0) || !buybackDeal.leg2_isin) {
    console.warn(
      `Skip Buy/Sell leg2 Sell letter for ${buybackDeal.deal_number}: missing face/ISIN`
    );
    return null;
  }

  if (hasBuybackDealId) {
    const existing = await findExistingLetterGsec(query, buybackIdNum, 'Sell');
    if (existing) {
      console.log(
        `Buy/Sell leg2 Sell letter already exists for ${buybackDeal.deal_number}: ${existing.deal_number}`
      );
      return existing.id;
    }
  }

  const coupon = await resolveCouponFields(
    buybackDeal.leg2_isin,
    buybackDeal.leg2_value_date,
    buybackDeal,
    face
  );
  if (!coupon) {
    console.warn(
      `ISIN not found for Buy/Sell leg2 Sell letter: ${buybackDeal.leg2_isin}`
    );
    return null;
  }

  const externalCounterparty =
    (await resolveExternalBuybackCounterpartyId(buybackDeal)) ||
    buybackDeal.leg2_counterparty ||
    buybackDeal.leg1_counterparty;

  // No buyDealNumber / allocations — letter-only; oversell validation skips empty checks.
  const sellData = {
    tradeType: buybackDeal.leg2_trade_type || 'BuyBack',
    transactionType: 'Sell',
    counterparty: externalCounterparty,
    broker: buybackDeal.leg1_broker || null,
    dealNumber: null,
    isin: buybackDeal.leg2_isin,
    faceValue: face,
    valueDate: buybackDeal.leg2_value_date,
    nextCouponDate: coupon.nextCouponDate,
    lastCouponDate: coupon.lastCouponDate,
    numberOfDaysInterestAccrued: coupon.numberOfDaysInterestAccrued,
    numberOfDaysForCouponPeriod: coupon.numberOfDaysForCouponPeriod,
    accruedInterest: buybackDeal.leg2_accrued_interest || null,
    couponInterest: coupon.couponInterest,
    cleanPrice: buybackDeal.leg2_clean_price,
    dirtyPrice: buybackDeal.leg2_dirty_price,
    accruedInterestCalculation:
      coupon.couponRate != null && Number(coupon.couponRate) > 0
        ? Number(coupon.couponRate) / 2
        : null,
    settlementAmount: buybackDeal.leg2_settlement_amount,
    settlementMode: buybackDeal.leg2_settlement_mode,
    issueDate: coupon.issueDate,
    maturityDate: coupon.maturityDate,
    couponDates:
      coupon.couponDate1 && coupon.couponDate2
        ? `${coupon.couponDate1},${coupon.couponDate2}`
        : `${coupon.couponDate1 || ''},${coupon.couponDate2 || ''}`,
    yield: buybackDeal.leg2_yield_rate,
    brokerage: buybackDeal.leg1_brokerage || 0,
    currency: buybackDeal.leg2_currency || 'LKR',
    portfolio: buybackDeal.leg2_portfolio,
    strategy: buybackDeal.leg2_strategy,
    custodian: buybackDeal.leg2_custodian,
    tradeDate: buybackDeal.leg2_trade_date || buybackDeal.leg2_value_date,
    buyDealNumber: null,
    sellDealAllocations: null,
    userId: normalizeUserId(userId),
    current_approval_level: null,
    status: 'final_approved',
    fundMovement: buybackDeal.fund_movement,
    skipCashflowCapture: true
  };

  const result = await Gsec.createWithConnection(sellData, connection || null);
  if (hasBuybackDealId && result?.insertId) {
    await query('UPDATE gsec SET buyback_deal_id = ? WHERE id = ?', [
      buybackIdNum,
      result.insertId
    ]);
  }
  console.log(
    `Created Buy/Sell leg2 Sell letter for ${buybackDeal.deal_number}, gsecId=${result.insertId}`
  );
  return result?.insertId || null;
}

/**
 * Create both letter GSEC rows for a Buy/Sell buyback.
 * @returns {Promise<{ buyId: number|null, sellId: number|null }>}
 */
async function createBuybackBuySellLetterGsecs(opts) {
  const buyId = await createBuySellLeg1BuyLetterGsec(opts);
  const sellId = await createBuySellLeg2SellLetterGsec(opts);
  return { buyId, sellId };
}

module.exports = {
  createBuybackBuySellLetterGsecs,
  createBuySellLeg1BuyLetterGsec,
  createBuySellLeg2SellLetterGsec,
  getLegEffectiveFace
};
