'use strict';

/**
 * Create a final_approved GSEC Sell row for Sell/Buy buyback leg 1 so settlement
 * instruction letters (/api/gsec/:id/letter) work. Does not deduct remaining_face
 * or post sell GL — those stay on the buyback approval path.
 */

const Gsec = require('../models/gsec');
const db = require('../config/database');
const { normalizeUserId } = require('../utils/requestUser');
const dealConfirmationService = require('./dealConfirmationService');
const {
  getCouponPeriodLengthDaysFromIsinSchedule,
  resolveIsinCouponDates,
  getCouponPeriodEOverride
} = require('./gsecCouponPeriod');

const isOwnCompanyCounterparty = (details) => {
  if (!details || !details.name) return false;
  const normalize = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');
  const own = normalize(dealConfirmationService.COMPANY.name);
  const name = normalize(details.name);
  return name === own || name.startsWith('sherwoodcapital');
};

/** Prefer external (non-Sherwood) counterparty for instruction letters. */
const resolveExternalBuybackCounterpartyId = async (deal) => {
  const candidates = [deal.leg2_counterparty, deal.leg1_counterparty].filter(Boolean);
  for (const candidate of candidates) {
    const details = await dealConfirmationService.fetchCounterpartyDetails(candidate);
    if (details && !isOwnCompanyCounterparty(details)) return candidate;
  }
  return candidates[0] || null;
};

const getLeg1EffectiveFace = (leg1OrBuybackRow) => {
  const adj = parseFloat(
    leg1OrBuybackRow?.adjustedFaceValue ?? leg1OrBuybackRow?.leg1_adjusted_face_value
  );
  const face = parseFloat(leg1OrBuybackRow?.faceValue ?? leg1OrBuybackRow?.leg1_face_value);
  if (Number.isFinite(adj) && adj > 0) return adj;
  if (Number.isFinite(face) && face > 0) return face;
  return 0;
};

const mapSellAllocations = (allocations) => {
  if (!Array.isArray(allocations)) return [];
  return allocations
    .map((a) => ({
      deal_number: a.deal_number || a.buy_deal_number,
      amountToSell: Number(a.amountToSell) || 0
    }))
    .filter((a) => a.deal_number && a.amountToSell > 0);
};

/**
 * @returns {Promise<number|null>} gsec id when created or already present
 */
async function createBuybackLeg1SellGsec({
  buybackDeal,
  buybackIdNum,
  hasBuybackDealId,
  allocations,
  connection,
  userId
}) {
  const query = connection ? connection.query.bind(connection) : db.query.bind(db);
  const leg1Face = getLeg1EffectiveFace(buybackDeal);
  if (!(leg1Face > 0) || !buybackDeal.leg1_isin) {
    console.warn(
      `Skip GSEC Sell create for buyback ${buybackDeal.deal_number}: missing face/ISIN`
    );
    return null;
  }

  let rawAllocs = allocations;
  if (rawAllocs == null && buybackDeal.sell_deal_allocations) {
    try {
      rawAllocs =
        typeof buybackDeal.sell_deal_allocations === 'string'
          ? JSON.parse(buybackDeal.sell_deal_allocations)
          : buybackDeal.sell_deal_allocations;
    } catch {
      rawAllocs = null;
    }
  }
  let sellAllocs = mapSellAllocations(rawAllocs);
  if (!sellAllocs.length && buybackDeal.source_buy_deal_number) {
    sellAllocs = [
      {
        deal_number: buybackDeal.source_buy_deal_number,
        amountToSell: leg1Face
      }
    ];
  }
  if (!sellAllocs.length) {
    console.warn(
      `Skip GSEC Sell create for buyback ${buybackDeal.deal_number}: no sell allocations`
    );
    return null;
  }

  if (hasBuybackDealId) {
    const [existingSell] = await query(
      `SELECT id, deal_number FROM gsec
       WHERE transaction_type = 'Sell'
         AND COALESCE(status, '') <> 'cancelled'
         AND buyback_deal_id = ?
       ORDER BY id ASC
       LIMIT 1`,
      [buybackIdNum]
    );
    if (existingSell && existingSell.length > 0) {
      console.log(
        `GSEC Sell already exists for buyback ${buybackDeal.deal_number}: ${existingSell[0].deal_number}`
      );
      return existingSell[0].id;
    }
  }

  const [isinData] = await db.query('SELECT * FROM isin_master WHERE isin_number = ?', [
    buybackDeal.leg1_isin
  ]);
  if (!isinData || isinData.length === 0) {
    console.warn(
      `ISIN master data not found for ${buybackDeal.leg1_isin}; skipped GSEC Sell create`
    );
    return null;
  }

  const isin = isinData[0];
  const issueDate = buybackDeal.issue_date || isin.issue_date;
  const maturityDate = buybackDeal.maturity_date || isin.maturity_date;
  const couponDate1 = buybackDeal.coupon_date1 || isin.coupon_date_1;
  const couponDate2 = buybackDeal.coupon_date2 || isin.coupon_date_2;
  const couponRate = buybackDeal.coupon_rate || isin.coupon_rate || 0;
  const couponInterest = (leg1Face * parseFloat(couponRate || 0)) / 100 / 2;

  let lastCouponDate = null;
  let nextCouponDate = null;
  let numberOfDaysInterestAccrued = null;
  let numberOfDaysForCouponPeriod = null;

  if (buybackDeal.leg1_value_date && maturityDate) {
    try {
      const resolved = resolveIsinCouponDates({
        isin_number: buybackDeal.leg1_isin,
        coupon_date_1: couponDate1,
        coupon_date_2: couponDate2
      });
      const sched = getCouponPeriodLengthDaysFromIsinSchedule(
        buybackDeal.leg1_value_date,
        maturityDate,
        resolved.coupon_date_1,
        resolved.coupon_date_2
      );
      if (sched && sched.E > 0) {
        lastCouponDate = sched.lastCoupon.toISOString().slice(0, 10);
        nextCouponDate = sched.nextCoupon.toISOString().slice(0, 10);
        numberOfDaysForCouponPeriod = sched.E;
        const valueDate = new Date(buybackDeal.leg1_value_date);
        numberOfDaysInterestAccrued = Math.floor(
          (valueDate - sched.lastCoupon) / (1000 * 60 * 60 * 24)
        );
      }
    } catch (e) {
      console.warn(
        'Failed to compute coupon period for buyback Sell GSEC; continuing:',
        e.message
      );
    }
  }
  const eOverride = getCouponPeriodEOverride(buybackDeal.leg1_isin);
  if (eOverride) numberOfDaysForCouponPeriod = eOverride;

  const externalCounterparty =
    (await resolveExternalBuybackCounterpartyId(buybackDeal)) ||
    buybackDeal.leg1_counterparty ||
    buybackDeal.leg2_counterparty;

  const sellData = {
    tradeType: buybackDeal.leg1_trade_type || 'BuyBack',
    transactionType: 'Sell',
    counterparty: externalCounterparty,
    broker: buybackDeal.leg1_broker || null,
    dealNumber: null,
    isin: buybackDeal.leg1_isin,
    faceValue: leg1Face,
    valueDate: buybackDeal.leg1_value_date,
    nextCouponDate,
    lastCouponDate,
    numberOfDaysInterestAccrued,
    numberOfDaysForCouponPeriod,
    accruedInterest: buybackDeal.leg1_accrued_interest || null,
    couponInterest,
    cleanPrice: buybackDeal.leg1_clean_price,
    dirtyPrice: buybackDeal.leg1_dirty_price,
    accruedInterestCalculation:
      couponRate != null && Number(couponRate) > 0 ? Number(couponRate) / 2 : null,
    accruedInterestSixDecimals: null,
    accruedInterestFor100: null,
    accruedInterestBase: null,
    settlementAmount: buybackDeal.leg1_settlement_amount,
    settlementMode: buybackDeal.leg1_settlement_mode,
    issueDate,
    maturityDate,
    couponDates:
      couponDate1 && couponDate2
        ? `${couponDate1},${couponDate2}`
        : `${couponDate1 || ''},${couponDate2 || ''}`,
    yield: buybackDeal.leg1_yield_rate,
    brokerage: buybackDeal.leg1_brokerage || 0,
    currency: buybackDeal.leg1_currency || 'LKR',
    portfolio: buybackDeal.leg1_portfolio,
    strategy: buybackDeal.leg1_strategy,
    accruedInterestAdjustment: null,
    cleanPriceAdjustment: null,
    custodian: buybackDeal.leg1_custodian,
    tradeDate: buybackDeal.leg1_trade_date || buybackDeal.leg1_value_date,
    buyDealNumber: sellAllocs[0].deal_number,
    sellDealAllocations: sellAllocs,
    userId: normalizeUserId(userId),
    current_approval_level: null,
    status: 'final_approved',
    fundMovement: buybackDeal.fund_movement,
    skipCashflowCapture: true
  };

  const gsecResult = await Gsec.createWithConnection(sellData, connection || null);
  if (hasBuybackDealId && gsecResult && gsecResult.insertId) {
    await query('UPDATE gsec SET buyback_deal_id = ? WHERE id = ?', [
      buybackIdNum,
      gsecResult.insertId
    ]);
  }
  console.log(
    `Created GSEC Sell for buyback ${buybackDeal.deal_number}, gsecId=${gsecResult.insertId}`
  );
  return gsecResult?.insertId || null;
}

module.exports = {
  createBuybackLeg1SellGsec,
  getLeg1EffectiveFace,
  mapSellAllocations,
  resolveExternalBuybackCounterpartyId
};
