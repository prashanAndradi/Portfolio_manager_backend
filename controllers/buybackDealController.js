const BuybackDeal = require('../models/buybackDealModel');
const { resolveRequestUserId } = require('../utils/requestUser');
const { resolveEffectiveWorkflowAuth } = require('../utils/effectiveWorkflowAuth');
const { checkDealerLimitAndNotify } = require('../services/dealerLimitCheckService');
const { checkApprovalLimit } = require('../services/approvalLimitService');
const Gsec = require('../models/gsec');
const db = require('../config/database');
const { getSystemDay } = require('../models/systemDayModel');
const holidayValidationService = require('../services/holidayValidationService');
const {
  postFinalApprovedBuyLedger,
  postFinalApprovedSellLedger,
  truncate8: truncate8Ledger
} = require('../services/gsecApprovalLedgerService');
const {
  getCouponPeriodLengthDaysFromIsinSchedule,
  resolveIsinCouponDates,
  getCouponPeriodEOverride
} = require('../services/gsecCouponPeriod');
const { postBuySellBuybackLedger } = require('../services/buybackBuySellLedgerService');
const {
  createBuybackLeg1SellGsec,
  getLeg1EffectiveFace,
  mapSellAllocations
} = require('../services/buybackLeg1SellGsecService');
const {
  createBuybackBuySellLetterGsecs
} = require('../services/buybackBuySellLetterGsecService');

// Helper function to convert empty strings to null for numeric fields
const sanitizeNumeric = (value) => {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
};

// Read-only/computed financial values that must be populated before a buyback can
// be saved. They are derived on the form (reverse/forward price calc); when blank
// they previously persisted as 0 / column-default garbage on the leg, producing
// inconsistent ledgers. Prices/settlement/yield must be > 0; accrued must at least
// be a real number (0 is valid on a coupon date).
const REQUIRED_POSITIVE_LEG_FIELDS = [
  ['cleanPrice', 'Clean Price'],
  ['dirtyPrice', 'Dirty Price'],
  ['settlementAmount', 'Settlement Amount'],
  ['yield', 'Yield']
];

const isBlankOrNonPositive = (value) => {
  if (value === '' || value === null || value === undefined) return true;
  const n = parseFloat(value);
  return !Number.isFinite(n) || n <= 0;
};

const isBlankNumber = (value) => {
  if (value === '' || value === null || value === undefined) return true;
  return !Number.isFinite(parseFloat(value));
};

/**
 * Validate that a leg's read-only/computed values are present.
 * @param {object} leg - leg payload (frontend-shaped, e.g. { cleanPrice, dirtyPrice, settlementAmount, yield, accruedInterest })
 * @param {string} legName - label for error messages, e.g. 'Leg 1'
 * @returns {string|null} error message when invalid, otherwise null
 */
const validateComputedLegValues = (leg, legName) => {
  if (!leg) return `${legName} data is required`;
  for (const [field, label] of REQUIRED_POSITIVE_LEG_FIELDS) {
    if (isBlankOrNonPositive(leg[field])) {
      return `${legName}: ${label} is empty. Computed values must be calculated before the deal can be saved.`;
    }
  }
  if (isBlankNumber(leg.accruedInterest)) {
    return `${legName}: Accrued Interest is empty. Computed values must be calculated before the deal can be saved.`;
  }
  return null;
};

/**
 * For a Sell/Buy buyback the Leg 1 Sell must be backed by explicit buy-deal
 * allocations selected from the sell holdings modal. Without them the approval
 * step cannot deduct from (or post the sell GL against) specific buy deals, which
 * leaves the GSEC report and stored balances inconsistent. Enforce that a Sell
 * Leg 1 always carries at least one valid allocation.
 *
 * @param {object} leg1 - leg1 payload (frontend-shaped)
 * @param {Array} sellDeals - allocations from the sell modal [{ deal_number|buy_deal_number, amountToSell }]
 * @returns {string|null} error message when invalid, otherwise null
 */
const validateSellLegAllocations = (leg1, sellDeals) => {
  const isSell = String(leg1?.transactionType || '').toLowerCase() === 'sell';
  if (!isSell) return null;

  if (!Array.isArray(sellDeals) || sellDeals.length === 0) {
    return 'Leg 1 (Sell): you must allocate buy deals from the sell holdings modal before the deal can be saved.';
  }

  for (const d of sellDeals) {
    const dealNo = d?.deal_number || d?.buy_deal_number;
    const amt = Number(d?.amountToSell);
    if (!dealNo || !Number.isFinite(amt) || amt <= 0) {
      return 'Leg 1 (Sell): each allocated buy deal must have a deal number and a positive amount to sell.';
    }
  }

  return null;
};

/** Sum of sell-modal allocation amounts (authoritative face for Sell buybacks). */
const sumSellAllocations = (allocations) => {
  if (!Array.isArray(allocations) || !allocations.length) return 0;
  return allocations.reduce((s, a) => s + (Number(a.amountToSell) || 0), 0);
};

/**
 * Sell-modal allocation sum is the authoritative leg1/leg2 face on Sell buybacks.
 * Settlement reverse-calc can change leg face without updating allocations; sync
 * leg faces (and proportionally scale settlements) to the allocation total instead
 * of shrinking allocations to match a recalculated face.
 */
const syncLegFacesToAllocationSum = (leg1, leg2, allocations) => {
  const isSell = String(leg1?.transactionType || '').toLowerCase() === 'sell';
  const mapped = mapSellAllocations(allocations);
  if (!isSell || !mapped.length) {
    return { leg1, leg2, allocations: mapped };
  }

  const allocSum = sumSellAllocations(mapped);
  if (!(allocSum > 0)) {
    return { leg1, leg2, allocations: mapped };
  }

  const scaleSettlement = (settlement, oldFace) => {
    const s = parseFloat(settlement);
    const oldF = parseFloat(oldFace);
    if (!Number.isFinite(s) || !Number.isFinite(oldF) || oldF <= 0) return settlement;
    if (Math.abs(oldF - allocSum) < 0.0001) return settlement;
    return (Math.round((s * allocSum / oldF) * 100) / 100).toFixed(2);
  };

  const oldLeg1Face = getLeg1EffectiveFace(leg1) || allocSum;
  const oldLeg2Face =
    parseFloat(leg2?.adjustedFaceValue ?? leg2?.adjusted_face_value) ||
    parseFloat(leg2?.faceValue ?? leg2?.face_value) ||
    oldLeg1Face;

  const leg1Synced = {
    ...leg1,
    faceValue: allocSum.toString(),
    adjustedFaceValue: allocSum.toString(),
    settlementAmount: scaleSettlement(leg1.settlementAmount, oldLeg1Face)
  };

  const leg2Synced = {
    ...leg2,
    faceValue: allocSum.toString(),
    adjustedFaceValue: allocSum.toString(),
    settlementAmount: scaleSettlement(leg2.settlementAmount, oldLeg2Face)
  };

  return { leg1: leg1Synced, leg2: leg2Synced, allocations: mapped };
};

/** Buyback workflow states that have NOT yet deducted from buy-deal holdings.
 *  Deduction happens at the 'Approved' transition, so any deal still in one of
 *  these states still holds an outstanding claim on the buy deal's balance. */
const UNDEDUCTED_BUYBACK_STATUSES = ['Draft', 'Pending_Verification', 'Verified', 'Pending_Final_Approval'];

/** Read a buy deal's current available face value (remaining, falling back to full face). */
const getBuyDealRemaining = async (buyDealNumber) => {
  const [rows] = await db.query(
    `SELECT remaining_face_value, face_value FROM gsec
     WHERE deal_number = ? AND transaction_type = 'Buy' LIMIT 1`,
    [buyDealNumber]
  );
  if (!rows || rows.length === 0) return null; // signals "not found"
  const r = rows[0];
  return parseFloat(r.remaining_face_value != null ? r.remaining_face_value : r.face_value || 0) || 0;
};

/** Sum amounts that other not-yet-deducted buybacks have already earmarked against a buy deal. */
const sumOutstandingBuybackClaims = async (buyDealNumber, excludeDealNumber = null) => {
  const [rows] = await db.query(
    `SELECT deal_number, sell_deal_allocations FROM buyback_deals
     WHERE leg1_transaction_type = 'Sell'
       AND sell_deal_allocations IS NOT NULL
       AND deal_status IN (${UNDEDUCTED_BUYBACK_STATUSES.map(() => '?').join(',')})`,
    UNDEDUCTED_BUYBACK_STATUSES
  );
  let total = 0;
  for (const row of rows) {
    if (excludeDealNumber && row.deal_number === excludeDealNumber) continue;
    let allocs;
    try {
      allocs = typeof row.sell_deal_allocations === 'string'
        ? JSON.parse(row.sell_deal_allocations)
        : row.sell_deal_allocations;
    } catch {
      continue;
    }
    if (!Array.isArray(allocs)) continue;
    for (const a of allocs) {
      const dn = a?.deal_number || a?.buy_deal_number;
      if (dn === buyDealNumber) total += Number(a?.amountToSell) || 0;
    }
  }
  return total;
};

/**
 * Cumulative availability guard for a Sell Leg 1.
 *
 * The historical oversell happened because remaining_face_value is only decremented
 * at final approval, so multiple pending buybacks could each be created against the
 * SAME buy deal's full balance and then all approved, posting more sell ledger than
 * the holding ever contained. This rejects an allocation whose requested amount —
 * together with what other still-pending buybacks have already earmarked — exceeds
 * the buy deal's available balance.
 *
 * @param {object} leg1
 * @param {Array} sellDeals
 * @param {string|null} excludeDealNumber  deal being edited (so it doesn't count itself)
 * @returns {Promise<string|null>} error message when invalid, otherwise null
 */
const validateBuyDealAvailability = async (leg1, sellDeals, excludeDealNumber = null) => {
  const isSell = String(leg1?.transactionType || '').toLowerCase() === 'sell';
  if (!isSell || !Array.isArray(sellDeals) || sellDeals.length === 0) return null;

  // Aggregate requested amount per buy deal (a deal may be listed more than once).
  const requestedByDeal = new Map();
  for (const d of sellDeals) {
    const dn = d?.deal_number || d?.buy_deal_number;
    const amt = Number(d?.amountToSell) || 0;
    if (!dn || amt <= 0) continue;
    requestedByDeal.set(dn, (requestedByDeal.get(dn) || 0) + amt);
  }

  for (const [dn, requested] of requestedByDeal.entries()) {
    const remaining = await getBuyDealRemaining(dn);
    if (remaining === null) {
      return `Leg 1 (Sell): buy deal ${dn} was not found.`;
    }
    const earmarked = await sumOutstandingBuybackClaims(dn, excludeDealNumber);
    const available = remaining - earmarked;
    if (requested > available + 0.0001) {
      return (
        `Leg 1 (Sell): the amount allocated from buy deal ${dn} ` +
        `(${requested.toLocaleString()}) exceeds its available balance ` +
        `(${available.toLocaleString()}; ${remaining.toLocaleString()} remaining` +
        (earmarked > 0 ? ` less ${earmarked.toLocaleString()} already earmarked by other pending buybacks` : '') +
        `). Reduce the amount or pick another buy deal.`
      );
    }
  }
  return null;
};

/** Post settlement only once the book system day is on or after leg2 value date (same rule as GSec EOD). */
function valueDateOnOrBeforeSystemDay(valueDate, systemDay) {
  if (valueDate == null || systemDay == null) return false;
  const v = new Date(valueDate);
  const s = new Date(systemDay);
  if (Number.isNaN(v.getTime()) || Number.isNaN(s.getTime())) return false;
  const vUtc = Date.UTC(v.getFullYear(), v.getMonth(), v.getDate());
  const sUtc = Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
  return vUtc <= sUtc;
}

const buybackDealController = {
  // Create a new buyback deal
  createDeal: async (req, res) => {
    try {
      const { leg1: rawLeg1, leg2: rawLeg2, sellDeals: rawSellDeals, source_buy_deal_number, fund_movement } = req.body;
      const { leg1, leg2, allocations: sellDeals } = syncLegFacesToAllocationSum(rawLeg1, rawLeg2, rawSellDeals);

      // Validate required fields
      if (!leg1 || !leg2) {
        return res.status(400).json({ 
          success: false, 
          error: 'Both leg1 and leg2 data are required' 
        });
      }

      // Read-only/computed values must be populated; blank values must not be saved.
      const leg1ComputedError = validateComputedLegValues(leg1, 'Leg 1');
      if (leg1ComputedError) {
        return res.status(400).json({ success: false, error: leg1ComputedError });
      }
      const leg2ComputedError = validateComputedLegValues(leg2, 'Leg 2');
      if (leg2ComputedError) {
        return res.status(400).json({ success: false, error: leg2ComputedError });
      }

      // A Sell Leg 1 must carry buy-deal allocations from the sell holdings modal.
      const sellAllocationError = validateSellLegAllocations(leg1, sellDeals);
      if (sellAllocationError) {
        return res.status(400).json({ success: false, error: sellAllocationError });
      }

      // Reject allocations that would oversell a buy deal once other pending
      // buybacks' outstanding claims are taken into account.
      const availabilityError = await validateBuyDealAvailability(leg1, sellDeals);
      if (availabilityError) {
        return res.status(400).json({ success: false, error: availabilityError });
      }

      // Holiday validation - check if transaction dates are holidays
      // Check both legs for holidays
      const currency1 = leg1.currency || 'LKR';
      const currency2 = leg2.currency || 'LKR';
      
      // Check leg1 dates
      const holidayValidation1 = await holidayValidationService.validateTransactionDates({
        tradeDate: leg1.tradeDate,
        valueDate: leg1.valueDate,
        currency: currency1
      });

      if (holidayValidation1.isHoliday) {
        return res.status(400).json({
          success: false,
          error: 'Transaction cannot be saved on a holiday',
          message: `Leg 1: ${holidayValidation1.message}`
        });
      }

      // Check leg2 dates
      const holidayValidation2 = await holidayValidationService.validateTransactionDates({
        tradeDate: leg2.tradeDate,
        valueDate: leg2.valueDate,
        currency: currency2
      });

      if (holidayValidation2.isHoliday) {
        return res.status(400).json({
          success: false,
          error: 'Transaction cannot be saved on a holiday',
          message: `Leg 2: ${holidayValidation2.message}`
        });
      }

      // Generate deal number
      const dealNumber = await BuybackDeal.generateDealNumber();

      // Prepare deal data
      const dealData = {
        deal_number: dealNumber,
        leg1: {
          tradeDate: leg1.tradeDate,
          valueDate: leg1.valueDate,
          transactionType: leg1.transactionType,
          tradeType: leg1.tradeType || 'BuyBack',
          isin: leg1.isin,
          counterparty: leg1.counterparty,
          broker: leg1.broker || null,
          portfolio: leg1.portfolio,
          strategy: leg1.strategy,
          custodian: leg1.custodian,
          settlementMode: leg1.settlementMode,
          brokerage: sanitizeNumeric(leg1.brokerage) || 0,
          interestRate: sanitizeNumeric(leg1.interestRate) || 0,
          faceValue: sanitizeNumeric(leg1.faceValue),
          adjustedFaceValue: sanitizeNumeric(leg1.adjustedFaceValue),
          yield: sanitizeNumeric(leg1.yield),
          settlementAmount: sanitizeNumeric(leg1.settlementAmount),
          cleanPrice: sanitizeNumeric(leg1.cleanPrice),
          dirtyPrice: sanitizeNumeric(leg1.dirtyPrice),
          accruedInterest: sanitizeNumeric(leg1.accruedInterest),
          currency: leg1.currency || 'LKR'
        },
        leg2: {
          tradeDate: leg2.tradeDate,
          valueDate: leg2.valueDate,
          transactionType: leg2.transactionType || 'Sell',
          tradeType: leg2.tradeType || 'BuyBack',
          isin: leg2.isin,
          counterparty: leg2.counterparty,
          portfolio: leg2.portfolio,
          strategy: leg2.strategy,
          custodian: leg2.custodian,
          settlementMode: leg2.settlementMode,
          faceValue: sanitizeNumeric(leg2.faceValue),
          adjustedFaceValue: sanitizeNumeric(leg2.adjustedFaceValue),
          yield: sanitizeNumeric(leg2.yield),
          settlementAmount: sanitizeNumeric(leg2.settlementAmount),
          cleanPrice: sanitizeNumeric(leg2.cleanPrice),
          dirtyPrice: sanitizeNumeric(leg2.dirtyPrice),
          accruedInterest: sanitizeNumeric(leg2.accruedInterest),
          currency: leg2.currency || 'LKR'
        },
        // ISIN metadata (from leg1)
        issueDate: leg1.issueDate || null,
        maturityDate: leg1.maturityDate || null,
        couponRate: sanitizeNumeric(leg1.couponRate),
        couponDate1: leg1.couponDate1,
        couponDate2: leg1.couponDate2,
        // Status and tracking
        deal_status: 'Pending_Verification',
        fund_movement: String(fund_movement || 'no').toLowerCase() === 'yes' ? 'yes' : 'no',
        created_by: resolveRequestUserId(req),
        notes: req.body.notes || null,
        source_buy_deal_number: source_buy_deal_number || null,
        // Persist per-deal allocations so approval can deduct exact amounts from each buy deal
        sell_deal_allocations: Array.isArray(sellDeals) && sellDeals.length > 0
          ? sellDeals.map(d => ({
              deal_number: d.deal_number || d.buy_deal_number,
              amountToSell: Number(d.amountToSell) || 0
            }))
          : null
      };

      const result = await BuybackDeal.create(dealData);
      // Important: buyback-linked GSec leg 2 is created only after final authorization (status=Approved).

      // Checked against leg1 (the opening leg actually dealt by the front-office user).
      let limitWarning = null;
      try {
        const check = await checkDealerLimitAndNotify({
          userId: dealData.created_by,
          productType: 'buyback',
          dealNumber,
          amount: dealData.leg1.faceValue,
          currency: dealData.leg1.currency || 'LKR'
        });
        if (check.breached) limitWarning = { message: check.message, limit: check.limit, amount: check.amount };
      } catch (limitErr) {
        console.error('[buyback createDeal] Dealer limit check failed (non-fatal):', limitErr.message);
      }

      res.status(201).json({
        success: true,
        message: 'Buyback deal created successfully',
        data: {
          id: result.insertId,
          deal_number: dealNumber,
          status: 'Pending_Verification'
        },
        limitWarning
      });

    } catch (error) {
      console.error('Error creating buyback deal:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create buyback deal: ' + error.message
      });
    }
  },

  // Get all buyback deals
  getAllDeals: async (req, res) => {
    try {
      const deals = await BuybackDeal.getAll();
      res.json({
        success: true,
        data: deals
      });
    } catch (error) {
      console.error('Error fetching buyback deals:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch buyback deals: ' + error.message
      });
    }
  },

  // Get a single buyback deal
  getDealById: async (req, res) => {
    try {
      const { id } = req.params;
      const deal = await BuybackDeal.getById(id);
      
      if (!deal) {
        return res.status(404).json({
          success: false,
          error: 'Buyback deal not found'
        });
      }

      res.json({
        success: true,
        data: deal
      });
    } catch (error) {
      console.error('Error fetching buyback deal:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch buyback deal: ' + error.message
      });
    }
  },

  // Get deals by status
  getDealsByStatus: async (req, res) => {
    try {
      const { status } = req.params;
      const validStatuses = ['Draft', 'Pending_Verification', 'Verified', 'Pending_Final_Approval', 'Approved', 'Rejected', 'Settled'];
      
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status. Valid statuses: ' + validStatuses.join(', ')
        });
      }

      const deals = await BuybackDeal.getByStatus(status);
      res.json({
        success: true,
        data: deals
      });
    } catch (error) {
      console.error('Error fetching deals by status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch deals: ' + error.message
      });
    }
  },

  // Update deal status (for verification/approval workflow)
  updateDealStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const { status, action } = req.body;
      const buybackIdNum = Number(id);
      const [buybackLinkColRows] = await db.query(
        `SELECT 1
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'gsec'
           AND COLUMN_NAME = 'buyback_deal_id'
         LIMIT 1`
      );
      const hasBuybackDealId = Array.isArray(buybackLinkColRows) && buybackLinkColRows.length > 0;

      const validStatuses = ['Verified', 'Pending_Final_Approval', 'Approved', 'Rejected'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status for update'
        });
      }

      // Enforce the 3-tier workflow sequence and stage ownership. Without this,
      // this endpoint (like status updates elsewhere) would accept ANY target
      // status from ANY caller regardless of the deal's current stage, letting
      // a deal jump e.g. Pending_Verification -> Pending_Final_Approval directly
      // and skip the Back Office Verifier check entirely. Mirrors the same
      // current-stage-owns-the-action model as repoDealController.updateApprovalStatus.
      const STAGE_OWNER_ROLES = {
        Pending_Verification: ['front_office', 'front_office_verifier'],
        Verified: ['back_office_verifier'],
        Pending_Final_Approval: ['back_office_final']
      };
      const NEXT_STATUS_BY_CURRENT = {
        Pending_Verification: ['Verified', 'Rejected'],
        Verified: ['Pending_Final_Approval', 'Rejected'],
        Pending_Final_Approval: ['Approved', 'Rejected']
      };

      const actor = await resolveEffectiveWorkflowAuth(resolveRequestUserId(req));
      if (!actor) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      if (!actor.isAdmin && !actor.allowedTabs.includes('buyback')) {
        return res.status(403).json({ success: false, error: 'Access denied: buyback not assigned' });
      }

      const [currentDealRows] = await db.query(
        'SELECT deal_status, deal_number, leg1_face_value, leg1_adjusted_face_value FROM buyback_deals WHERE id = ? LIMIT 1',
        [id]
      );
      if (!currentDealRows.length) {
        return res.status(404).json({ success: false, error: 'Buyback deal not found' });
      }
      const currentStatus = currentDealRows[0].deal_status;
      const allowedNextStatuses = NEXT_STATUS_BY_CURRENT[currentStatus];
      if (!allowedNextStatuses || !allowedNextStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: `Cannot move deal to ${status}: current status is ${currentStatus}.`
        });
      }
      const requiredRoles = STAGE_OWNER_ROLES[currentStatus] || [];
      if (!actor.isAdmin && !requiredRoles.includes(actor.role)) {
        return res.status(403).json({
          success: false,
          error: `Access denied: ${requiredRoles.join(' or ')} role required at this stage.`
        });
      }

      // An authorizer needs enough of their OWN configured limit to advance a
      // deal (rejecting never needs it - only "proceeding" does).
      if (status !== 'Rejected') {
        const dealAmount = Number(
          currentDealRows[0].leg1_adjusted_face_value ?? currentDealRows[0].leg1_face_value
        ) || 0;
        const limitCheck = await checkApprovalLimit({
          actor,
          requiredRoles,
          dealAmount,
          dealNumber: currentDealRows[0].deal_number,
          productType: 'buyback',
          stageKey: currentStatus
        });
        if (!limitCheck.ok) {
          return res.status(403).json({
            success: false,
            limitExceeded: true,
            error: limitCheck.message,
            yourLimit: limitCheck.yourLimit,
            dealAmount: limitCheck.dealAmount,
            eligibleApprovers: limitCheck.eligibleApprovers
          });
        }
      }
      const userId = actor.id;

      // Authoritative oversell guard at the moment of final approval: deduction posts
      // the FULL allocated amount to the ledger but the holding can only be reduced by
      // what's left, so an over-allocation would silently desync holdings vs ledger.
      // Block approval (before any status change or posting) if any allocation exceeds
      // the buy deal's current remaining balance.
      if (status === 'Approved') {
        const [apprRows] = await db.query(
          `SELECT leg1_transaction_type, sell_deal_allocations FROM buyback_deals WHERE id = ? LIMIT 1`,
          [id]
        );
        const apprDeal = apprRows && apprRows[0];
        if (apprDeal && apprDeal.leg1_transaction_type === 'Sell' && apprDeal.sell_deal_allocations) {
          let apprAllocs = null;
          try {
            apprAllocs = typeof apprDeal.sell_deal_allocations === 'string'
              ? JSON.parse(apprDeal.sell_deal_allocations)
              : apprDeal.sell_deal_allocations;
          } catch {
            apprAllocs = null;
          }
          if (Array.isArray(apprAllocs) && apprAllocs.length > 0) {
            const requestedByDeal = new Map();
            for (const a of apprAllocs) {
              const dn = a?.deal_number || a?.buy_deal_number;
              const amt = Number(a?.amountToSell) || 0;
              if (!dn || amt <= 0) continue;
              requestedByDeal.set(dn, (requestedByDeal.get(dn) || 0) + amt);
            }
            for (const [dn, requested] of requestedByDeal.entries()) {
              const remaining = await getBuyDealRemaining(dn);
              if (remaining === null) {
                return res.status(400).json({
                  success: false,
                  error: `Cannot approve: linked buy deal ${dn} no longer exists.`
                });
              }
              if (requested > remaining + 0.0001) {
                return res.status(400).json({
                  success: false,
                  error:
                    `Cannot approve: the amount allocated from buy deal ${dn} ` +
                    `(${requested.toLocaleString()}) exceeds its remaining balance ` +
                    `(${remaining.toLocaleString()}). Another deal likely consumed it first. ` +
                    `Edit the buyback to re-allocate before approving.`
                });
              }
            }
          }
        }
      }

      // Determine which field to update based on action and status
      let field = 'verified_by';
      let timestampField = 'verified_at';

      // Idempotent final approval: skip side effects if already approved (prevents duplicate leg2 GSEC).
      let wasAlreadyApproved = false;
      if (status === 'Approved') {
        const [preApproveRows] = await db.query(
          'SELECT deal_status FROM buyback_deals WHERE id = ? LIMIT 1',
          [id]
        );
        wasAlreadyApproved = preApproveRows?.[0]?.deal_status === 'Approved';
        if (wasAlreadyApproved) {
          console.log(`Buyback ${id} already Approved — skipping duplicate approval side effects`);
        }
      }
      
      if (action === 'approve' || status === 'Approved') {
        field = 'approved_by';
        timestampField = 'approved_at';
      } else if (action === 'verify' || status === 'Verified') {
        field = 'verified_by';
        timestampField = 'verified_at';
      } else if (status === 'Pending_Final_Approval') {
        // This is when back office verifier approves, we need to track who verified it
        field = 'verified_by';
        timestampField = 'verified_at';
      }

      // The legacy verified_by/approved_by columns above are keyed by `action`, which is
      // 'verify' for both the front-office check and the back-office-verifier approval -
      // so they can't tell those two tiers apart. Use the target `status`, which IS unique
      // per tier, to stamp a dedicated column for each of the three approval stages.
      let tierField = null;
      if (status === 'Verified') {
        tierField = 'front_office_by';
      } else if (status === 'Pending_Final_Approval') {
        tierField = 'back_office_verifier_by';
      } else if (status === 'Approved') {
        tierField = 'final_approved_by';
      }

      const result = await BuybackDeal.updateStatus(id, status, userId, field, timestampField, tierField);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          error: 'Buyback deal not found'
        });
      }

      // When a buyback is rejected, cancel auto-created / letter GSec rows linked to it
      if (status === 'Rejected') {
        try {
          const [buybackDeals] = await db.query('SELECT * FROM buyback_deals WHERE id = ?', [id]);
          if (buybackDeals && buybackDeals.length > 0) {
            const bb = buybackDeals[0];
            if (hasBuybackDealId) {
              const [linked] = await db.query(
                `SELECT id, deal_number, transaction_type FROM gsec
                 WHERE buyback_deal_id = ?
                   AND status = 'final_approved'`,
                [buybackIdNum]
              );
              for (const row of linked || []) {
                await db.query(
                  "UPDATE gsec SET status = 'cancelled', per_day_accrual = 0 WHERE id = ?",
                  [row.id]
                );
                console.log(
                  `Cancelled auto-created GSEC ${row.transaction_type} ${row.deal_number} (id=${row.id}) for rejected buyback ${bb.deal_number}`
                );
              }
            } else if (bb.leg2_transaction_type === 'Buy' && bb.leg2_isin) {
              const bbLeg2EffectiveFace = parseFloat(
                bb.leg2_adjusted_face_value !== null && bb.leg2_adjusted_face_value !== undefined
                  ? bb.leg2_adjusted_face_value
                  : bb.leg2_face_value
              );
              const [gsecRows] = await db.query(
                `SELECT id, deal_number FROM gsec
                 WHERE transaction_type = 'Buy'
                   AND isin_number = ?
                   AND face_value = ?
                   AND value_date = ?
                   AND portfolio = ?
                   AND status = 'final_approved'
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [bb.leg2_isin, bbLeg2EffectiveFace, bb.leg2_value_date, bb.leg2_portfolio]
              );
              if (gsecRows && gsecRows.length > 0) {
                await db.query(
                  "UPDATE gsec SET status = 'cancelled', per_day_accrual = 0 WHERE id = ?",
                  [gsecRows[0].id]
                );
              }
            }
          }
        } catch (cleanupErr) {
          console.error('Error cancelling GSec deal for rejected buyback:', cleanupErr);
        }
      }

      // Process face value deduction when deal is approved
      if (status === 'Approved' && !wasAlreadyApproved) {
        const connection = await db.pool.getConnection();
        try {
          await connection.beginTransaction();
          await connection.query('SELECT id FROM buyback_deals WHERE id = ? FOR UPDATE', [id]);

          // Get the buyback deal details (locked)
          const [buybackDeals] = await connection.query('SELECT * FROM buyback_deals WHERE id = ?', [id]);
          if (buybackDeals && buybackDeals.length > 0) {
            const buybackDeal = buybackDeals[0];
            const leg2EffectiveFace = parseFloat(
              buybackDeal.leg2_adjusted_face_value !== null && buybackDeal.leg2_adjusted_face_value !== undefined
                ? buybackDeal.leg2_adjusted_face_value
                : buybackDeal.leg2_face_value
            ) || 0;

            // Create GSec only at final authorization for leg2 Buy, with duplicate guard
            let leg2GsecIdForLedger = null;
            if (buybackDeal.leg2_transaction_type === 'Buy' && leg2EffectiveFace > 0) {
              const [existing] = hasBuybackDealId
                ? await connection.query(
                    `SELECT id, deal_number FROM gsec
                     WHERE transaction_type = 'Buy'
                       AND COALESCE(status, '') <> 'cancelled'
                       AND buyback_deal_id = ?
                     ORDER BY id ASC
                     LIMIT 1
                     FOR UPDATE`,
                    [buybackIdNum]
                  )
                : await connection.query(
                    `SELECT id, deal_number FROM gsec
                     WHERE transaction_type = 'Buy'
                       AND COALESCE(status, '') <> 'cancelled'
                       AND isin_number = ?
                       AND face_value = ?
                       AND value_date = ?
                       AND portfolio = ?
                     ORDER BY id ASC
                     LIMIT 1
                     FOR UPDATE`,
                    [
                      buybackDeal.leg2_isin,
                      leg2EffectiveFace,
                      buybackDeal.leg2_value_date,
                      buybackDeal.leg2_portfolio
                    ]
                  );

              if (!existing || existing.length === 0) {
                const [isinData] = await db.query(
                  'SELECT * FROM isin_master WHERE isin_number = ?',
                  [buybackDeal.leg2_isin]
                );

                if (isinData && isinData.length > 0) {
                  const isin = isinData[0];
                  const issueDate = buybackDeal.issue_date || isin.issue_date;
                  const maturityDate = buybackDeal.maturity_date || isin.maturity_date;
                  const couponDate1 = buybackDeal.coupon_date1 || isin.coupon_date_1;
                  const couponDate2 = buybackDeal.coupon_date2 || isin.coupon_date_2;

                  const [couponSchedule] = await db.query(
                    'SELECT * FROM isin_coupon_schedule WHERE isin COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci ORDER BY coupon_date ASC',
                    [buybackDeal.leg2_isin]
                  );

                  let lastCouponDate = null;
                  let nextCouponDate = null;
                  if (couponSchedule && couponSchedule.length > 0 && buybackDeal.leg2_value_date) {
                    const valueDateObj = new Date(buybackDeal.leg2_value_date);
                    for (let i = 0; i < couponSchedule.length; i++) {
                      const couponDate = new Date(couponSchedule[i].coupon_date);
                      if (couponDate <= valueDateObj) lastCouponDate = couponSchedule[i].coupon_date;
                      if (couponDate > valueDateObj) {
                        nextCouponDate = couponSchedule[i].coupon_date;
                        break;
                      }
                    }
                  }

                  const couponRate = buybackDeal.coupon_rate || isin.coupon_rate || 0;
                  // Semi-annual coupon: divide the annual coupon by 2 so it matches the
                  // per-period coupon stored by the manual GSEC entry page.
                  const couponInterest =
                    (leg2EffectiveFace * parseFloat(couponRate || 0)) / 100 / 2;

                  let numberOfDaysInterestAccrued = null;
                  let numberOfDaysForCouponPeriod = null;
                  // Prefer actual coupon-day schedule from isin_master (with overrides) so E matches calendar
                  // (e.g. 15-Mar -> 15-Sep is 184 days, not a fixed 182/183 assumption).
                  if (buybackDeal.leg2_value_date && maturityDate) {
                    try {
                      const resolved = resolveIsinCouponDates({
                        isin_number: buybackDeal.leg2_isin,
                        coupon_date_1: couponDate1,
                        coupon_date_2: couponDate2
                      });
                      const sched = getCouponPeriodLengthDaysFromIsinSchedule(
                        buybackDeal.leg2_value_date,
                        maturityDate,
                        resolved.coupon_date_1,
                        resolved.coupon_date_2
                      );
                      if (sched && sched.E > 0) {
                        lastCouponDate = sched.lastCoupon.toISOString().slice(0, 10);
                        nextCouponDate = sched.nextCoupon.toISOString().slice(0, 10);
                        numberOfDaysForCouponPeriod = sched.E;
                        const valueDate = new Date(buybackDeal.leg2_value_date);
                        numberOfDaysInterestAccrued = Math.floor(
                          (valueDate - sched.lastCoupon) / (1000 * 60 * 60 * 24)
                        );
                      }
                    } catch (e) {
                      console.warn('Failed to compute coupon period from ISIN schedule; using coupon_schedule dates:', e.message);
                    }
                  }
                  const eOverride = getCouponPeriodEOverride(buybackDeal.leg2_isin);
                  if (eOverride) {
                    numberOfDaysForCouponPeriod = eOverride;
                  }
                  // Fallback to coupon_schedule-derived boundaries if schedule-based calc failed
                  if (
                    (numberOfDaysForCouponPeriod === null || numberOfDaysForCouponPeriod === undefined) &&
                    lastCouponDate &&
                    nextCouponDate &&
                    buybackDeal.leg2_value_date
                  ) {
                    const lastDate = new Date(lastCouponDate);
                    const nextDate = new Date(nextCouponDate);
                    const valueDate = new Date(buybackDeal.leg2_value_date);
                    numberOfDaysInterestAccrued = Math.floor((valueDate - lastDate) / (1000 * 60 * 60 * 24));
                    numberOfDaysForCouponPeriod = Math.floor((nextDate - lastDate) / (1000 * 60 * 60 * 24));
                  }

                  const gsecDealData = {
                    tradeType: buybackDeal.leg2_trade_type || 'BuyBack',
                    transactionType: 'Buy',
                    counterparty: buybackDeal.leg2_counterparty,
                    broker: buybackDeal.leg1_broker || null,
                    dealNumber: null,
                    isin: buybackDeal.leg2_isin,
                    faceValue: leg2EffectiveFace,
                    valueDate: buybackDeal.leg2_value_date,
                    nextCouponDate: nextCouponDate,
                    lastCouponDate: lastCouponDate,
                    numberOfDaysInterestAccrued,
                    numberOfDaysForCouponPeriod,
                    accruedInterest: buybackDeal.leg2_accrued_interest || null,
                    couponInterest: couponInterest,
                    cleanPrice: buybackDeal.leg2_clean_price,
                    dirtyPrice: buybackDeal.leg2_dirty_price,
                    accruedInterestCalculation:
                      couponRate != null && Number(couponRate) > 0
                        ? Number(couponRate) / 2
                        : null,
                    accruedInterestSixDecimals: null,
                    accruedInterestFor100: null,
                    accruedInterestBase: null,
                    settlementAmount: buybackDeal.leg2_settlement_amount,
                    settlementMode: buybackDeal.leg2_settlement_mode,
                    issueDate: issueDate,
                    maturityDate: maturityDate,
                    couponDates:
                      couponDate1 && couponDate2 ? `${couponDate1},${couponDate2}` : `${couponDate1 || ''},${couponDate2 || ''}`,
                    yield: buybackDeal.leg2_yield_rate,
                    brokerage: buybackDeal.leg1_brokerage || 0,
                    currency: buybackDeal.leg2_currency || 'LKR',
                    portfolio: buybackDeal.leg2_portfolio,
                    strategy: buybackDeal.leg2_strategy,
                    accruedInterestAdjustment: null,
                    cleanPriceAdjustment: null,
                    custodian: buybackDeal.leg2_custodian,
                    tradeDate: buybackDeal.leg2_trade_date || buybackDeal.leg2_value_date,
                    userId,
                    current_approval_level: null,
                    status: 'final_approved',
                    // Carry the buyback's fund-movement flag onto the buy row -
                    // without it Gsec.create defaults to 'no' and the instruction
                    // letter renders RVF (free of payment) instead of RVP.
                    fundMovement: buybackDeal.fund_movement
                  };

                  const gsecResult = await Gsec.create(gsecDealData);
                  if (hasBuybackDealId && gsecResult && gsecResult.insertId) {
                    await connection.query('UPDATE gsec SET buyback_deal_id = ? WHERE id = ?', [
                      buybackIdNum,
                      gsecResult.insertId
                    ]);
                  }
                  if (gsecResult && gsecResult.insertId) {
                    leg2GsecIdForLedger = gsecResult.insertId;
                  }
                  console.log(
                    `Created GSec leg2 deal on buyback final approval. buyback=${buybackDeal.deal_number}, gsecId=${gsecResult.insertId}`
                  );
                } else {
                  console.warn(
                    `ISIN master data not found for ${buybackDeal.leg2_isin}; skipped GSec creation on approval`
                  );
                }
              } else {
                leg2GsecIdForLedger = existing[0].id;
                console.log(
                  `GSec leg2 already exists for buyback ${buybackDeal.deal_number}: ${existing[0].deal_number}`
                );
              }
            }

            if (leg2GsecIdForLedger) {
              try {
                const [gsecRows] = await db.query('SELECT * FROM gsec WHERE id = ?', [leg2GsecIdForLedger]);
                const gsecRow = gsecRows && gsecRows[0];
                if (gsecRow) {
                  const [leCount] = await db.query(
                    'SELECT COUNT(*) as cnt FROM ledger_entries WHERE deal_number = ?',
                    [gsecRow.deal_number]
                  );
                  if (leCount[0].cnt === 0) {
                    const systemDayRow = await getSystemDay();
                    const systemDate = systemDayRow && systemDayRow.system_date;
                    if (!systemDate) {
                      console.warn(
                        `Buyback leg2 buy ledger skipped (system day not set) for ${buybackDeal.deal_number}`
                      );
                    } else if (!valueDateOnOrBeforeSystemDay(gsecRow.value_date, systemDate)) {
                      console.log(
                        `Buyback leg2 buy ledger deferred until value date (leg2 VD after system day): buyback=${buybackDeal.deal_number}, leg2_value_date=${gsecRow.value_date}, system_date=${systemDate}`
                      );
                    } else {
                      const bbPrefix = `Buyback ${buybackDeal.deal_number} - `;
                      const buyLedgerRes = await postFinalApprovedBuyLedger(gsecRow, {
                        descriptionPrefix: bbPrefix,
                        bankAmountFromSettlement: true
                      });
                      if (!buyLedgerRes.success) {
                        console.error(
                          `Buyback leg2 buy ledger failed for ${buybackDeal.deal_number}:`,
                          buyLedgerRes.error
                        );
                      }
                    }
                  }
                }
              } catch (leg2LedgerErr) {
                console.error('Buyback leg2 buy ledger posting error:', leg2LedgerErr);
              }
            }
            
            // If this is a sell transaction, deduct from original buy deals
            if (buybackDeal.leg1_transaction_type === 'Sell') {
              console.log('Processing face value deduction for approved buyback deal:', buybackDeal.deal_number);

              const isin = buybackDeal.leg1_isin;
              const portfolio = buybackDeal.leg1_portfolio;

              // Parse per-deal allocations saved at deal creation time
              let allocations = null;
              if (buybackDeal.sell_deal_allocations) {
                try {
                  allocations = typeof buybackDeal.sell_deal_allocations === 'string'
                    ? JSON.parse(buybackDeal.sell_deal_allocations)
                    : buybackDeal.sell_deal_allocations;
                } catch (parseErr) {
                  console.warn('Failed to parse sell_deal_allocations, falling back to legacy logic:', parseErr.message);
                }
              }

              const leg1EffForDeduction = getLeg1EffectiveFace(buybackDeal);
              const allocSum = sumSellAllocations(allocations || []);
              if (
                allocations &&
                Array.isArray(allocations) &&
                allocations.length > 0 &&
                allocSum > 0 &&
                leg1EffForDeduction > 0 &&
                Math.abs(allocSum - leg1EffForDeduction) > 0.0001
              ) {
                const scaleMoney = (amount, oldFace) => {
                  const n = parseFloat(amount);
                  const oldF = parseFloat(oldFace);
                  if (!Number.isFinite(n) || !Number.isFinite(oldF) || oldF <= 0) return amount;
                  return (Math.round((n * allocSum / oldF) * 100) / 100).toFixed(2);
                };
                console.log(
                  `Syncing buyback ${buybackDeal.deal_number} leg faces to allocation sum ${allocSum} (was leg1 ${leg1EffForDeduction})`
                );
                await connection.query(
                  `UPDATE buyback_deals
                   SET leg1_face_value = ?,
                       leg1_adjusted_face_value = ?,
                       leg2_face_value = ?,
                       leg2_adjusted_face_value = ?,
                       leg1_settlement_amount = ?,
                       leg2_settlement_amount = ?
                   WHERE id = ?`,
                  [
                    allocSum.toFixed(2),
                    allocSum.toFixed(2),
                    allocSum.toFixed(2),
                    allocSum.toFixed(2),
                    scaleMoney(buybackDeal.leg1_settlement_amount, leg1EffForDeduction),
                    scaleMoney(buybackDeal.leg2_settlement_amount, leg1EffForDeduction),
                    buybackDeal.id
                  ]
                );
                buybackDeal.leg1_face_value = allocSum;
                buybackDeal.leg1_adjusted_face_value = allocSum;
                buybackDeal.leg2_face_value = allocSum;
                buybackDeal.leg2_adjusted_face_value = allocSum;
                buybackDeal.leg1_settlement_amount = scaleMoney(
                  buybackDeal.leg1_settlement_amount,
                  leg1EffForDeduction
                );
                buybackDeal.leg2_settlement_amount = scaleMoney(
                  buybackDeal.leg2_settlement_amount,
                  leg1EffForDeduction
                );
              }

              // Letter-printable GSEC Sell (mirror of leg2 Buy). Inventory deduction
              // and BB-L1 ledger still run below — this row must not double-count.
              try {
                await createBuybackLeg1SellGsec({
                  buybackDeal,
                  buybackIdNum,
                  hasBuybackDealId,
                  allocations,
                  connection,
                  userId
                });
              } catch (sellGsecErr) {
                console.error(
                  `Failed to create GSEC Sell for buyback ${buybackDeal.deal_number}:`,
                  sellGsecErr
                );
                // Do not abort approval side effects — holdings deduction + ledger
                // must still run; letter row can be backfilled later.
              }

              if (allocations && Array.isArray(allocations) && allocations.length > 0) {
                // --- New path: deduct exact allocated amount from each individual buy deal ---
                console.log(`Using stored allocations for deduction (${allocations.length} deal(s)):`, allocations);

                for (const alloc of allocations) {
                  const allocDealNumber = alloc.deal_number;
                  const allocAmount = parseFloat(alloc.amountToSell || 0);

                  if (!allocDealNumber || allocAmount <= 0) continue;

                  const [rows] = await db.query(
                    `SELECT id, deal_number, face_value, remaining_face_value
                     FROM gsec
                     WHERE deal_number = ? AND transaction_type = 'Buy'
                     LIMIT 1`,
                    [allocDealNumber]
                  );

                  if (!rows || rows.length === 0) {
                    console.warn(`Buy deal ${allocDealNumber} not found for allocated deduction`);
                    continue;
                  }

                  const buyDeal = rows[0];
                  const available = parseFloat(
                    buyDeal.remaining_face_value !== null && buyDeal.remaining_face_value !== undefined
                      ? buyDeal.remaining_face_value
                      : buyDeal.face_value || 0
                  );
                  const deductAmount = Math.min(allocAmount, available);
                  const newRemaining = Math.trunc((available - deductAmount) * 10000) / 10000;

                  await db.query(
                    'UPDATE gsec SET remaining_face_value = ? WHERE id = ?',
                    [newRemaining.toFixed(4), buyDeal.id]
                  );
                  await Gsec.syncFutureCouponCashflowsForBuyDeal(buyDeal.deal_number);

                  console.log(
                    `Deducted ${deductAmount} from buy deal ${allocDealNumber} (id=${buyDeal.id}). New remaining: ${newRemaining}`
                  );

                  if (allocAmount > available + 0.0001) {
                    console.warn(
                      `Allocation for ${allocDealNumber} (${allocAmount}) exceeded available balance (${available}). Deducted max: ${deductAmount}`
                    );
                  }
                }
              } else {
                // --- Legacy fallback: use source_buy_deal_number or FIFO ---
                const sellAmount = parseFloat(
                  buybackDeal.leg1_adjusted_face_value !== null && buybackDeal.leg1_adjusted_face_value !== undefined
                    ? buybackDeal.leg1_adjusted_face_value
                    : buybackDeal.leg1_face_value || 0
                );
                const sourceBuyDealNumber = buybackDeal.source_buy_deal_number;

                if (sellAmount > 0 && isin && portfolio) {
                  let buyDeals = [];

                  if (sourceBuyDealNumber) {
                    console.log(`Legacy: deducting from specific buy deal: ${sourceBuyDealNumber}`);
                    const [specificBuyDeals] = await db.query(`
                      SELECT * FROM gsec
                      WHERE deal_number = ? AND transaction_type = 'Buy'
                      AND (remaining_face_value > 0 OR remaining_face_value IS NULL)
                    `, [sourceBuyDealNumber]);

                    if (specificBuyDeals && specificBuyDeals.length > 0) {
                      buyDeals = specificBuyDeals;
                    } else {
                      console.warn(`Specific buy deal ${sourceBuyDealNumber} not found or has no remaining balance`);
                    }
                  }

                  if (buyDeals.length === 0) {
                    console.log('Legacy: falling back to chronological order for deduction');
                    const [chronologicalBuyDeals] = await db.query(`
                      SELECT * FROM gsec
                      WHERE isin_number = ? AND portfolio = ? AND transaction_type = 'Buy'
                      AND (remaining_face_value > 0 OR remaining_face_value IS NULL)
                      ORDER BY created_at ASC
                    `, [isin, portfolio]);
                    buyDeals = chronologicalBuyDeals;
                  }

                  let remainingToDeduct = sellAmount;

                  for (const buyDeal of buyDeals) {
                    if (remainingToDeduct <= 0) break;

                    const availableToDeduct = parseFloat(buyDeal.remaining_face_value || buyDeal.face_value || 0);
                    const deductAmount = Math.min(remainingToDeduct, availableToDeduct);

                    if (deductAmount > 0) {
                      const newRemaining = Math.trunc((availableToDeduct - deductAmount) * 10000) / 10000;
                      await db.query(
                        'UPDATE gsec SET remaining_face_value = ? WHERE id = ?',
                        [newRemaining.toFixed(4), buyDeal.id]
                      );
                      await Gsec.syncFutureCouponCashflowsForBuyDeal(buyDeal.deal_number);
                      console.log(`Legacy deducted ${deductAmount} from buy deal ${buyDeal.deal_number}. New remaining: ${newRemaining}`);
                      remainingToDeduct -= deductAmount;
                    }
                  }

                  if (remainingToDeduct > 0) {
                    console.warn(`Could not fully deduct ${remainingToDeduct} from buyback deal ${buybackDeal.deal_number} - insufficient buy deal balances`);
                  }
                }
              }

              try {
                const descPrefix = `Buyback ${buybackDeal.deal_number} - `;
                const leg1Den =
                  parseFloat(
                    buybackDeal.leg1_adjusted_face_value !== null &&
                      buybackDeal.leg1_adjusted_face_value !== undefined
                      ? buybackDeal.leg1_adjusted_face_value
                      : buybackDeal.leg1_face_value
                  ) || 0;
                const leg1Settlement = parseFloat(buybackDeal.leg1_settlement_amount) || 0;
                const leg1Accrued = parseFloat(buybackDeal.leg1_accrued_interest) || 0;

                const postSellSlice = async (buyDealNumber, faceSlice, syntheticDealNumber) => {
                  const [cntRows] = await db.query('SELECT COUNT(*) as cnt FROM ledger_entries WHERE deal_number = ?', [
                    syntheticDealNumber
                  ]);
                  if (cntRows[0].cnt > 0) return;
                  const ratio = leg1Den > 0 ? faceSlice / leg1Den : 1;
                  const sliceSettlement = truncate8Ledger(leg1Settlement * ratio);
                  const sliceAccrued = truncate8Ledger(leg1Accrued * ratio);
                  const sellLike = {
                    deal_number: syntheticDealNumber,
                    buy_deal_number: buyDealNumber,
                    face_value: faceSlice,
                    settlement_amount: sliceSettlement,
                    accrued_interest: sliceAccrued,
                    clean_price: buybackDeal.leg1_clean_price,
                    dirty_price: buybackDeal.leg1_dirty_price,
                    settlement_mode: buybackDeal.leg1_settlement_mode,
                    value_date: buybackDeal.leg1_value_date,
                    trade_date: buybackDeal.leg1_trade_date || buybackDeal.leg1_value_date,
                    transaction_type: 'Sell'
                  };
                  const r = await postFinalApprovedSellLedger(sellLike, { descriptionPrefix: descPrefix });
                  if (!r.success) {
                    console.error(`Buyback leg1 sell ledger failed ${syntheticDealNumber}:`, r.error);
                  }
                };

                if (allocations && Array.isArray(allocations) && allocations.length > 0) {
                  for (const alloc of allocations) {
                    const dn = alloc.deal_number;
                    const amt = parseFloat(alloc.amountToSell || 0);
                    if (!dn || amt <= 0) continue;
                    const synthetic = `${buybackDeal.deal_number}/BB-L1/${dn}`;
                    await postSellSlice(dn, amt, synthetic);
                  }
                } else if (buybackDeal.source_buy_deal_number && leg1Den > 0) {
                  const synthetic = `${buybackDeal.deal_number}/BB-L1/${buybackDeal.source_buy_deal_number}`;
                  await postSellSlice(buybackDeal.source_buy_deal_number, leg1Den, synthetic);
                }
              } catch (leg1GlErr) {
                console.error('Buyback leg1 sell ledger posting error:', leg1GlErr);
              }
            }

            // --- Buy/Sell buyback (leg1 = Buy, leg2 = Sell): ledger + letter GSEC rows ---
            // Complements the Sell/Buy logic above. Mutually exclusive per product.
            if (
              buybackDeal.leg1_transaction_type === 'Buy' &&
              buybackDeal.leg2_transaction_type === 'Sell'
            ) {
              try {
                await createBuybackBuySellLetterGsecs({
                  buybackDeal,
                  buybackIdNum,
                  hasBuybackDealId,
                  connection,
                  userId
                });
              } catch (letterErr) {
                console.error(
                  `Failed to create Buy/Sell letter GSECs for ${buybackDeal.deal_number}:`,
                  letterErr
                );
              }
              try {
                const buySell = await postBuySellBuybackLedger(buybackDeal);
                buySell.actions.forEach((a) => {
                  if (a.status === 'failed') {
                    console.error(
                      `Buyback ${buybackDeal.deal_number} ${a.leg} ${a.type} ledger failed:`,
                      a.error
                    );
                  } else {
                    console.log(
                      `Buyback ${buybackDeal.deal_number} ${a.leg} ${a.type} ledger (${a.deal_number}): ${a.status}`
                    );
                  }
                });
              } catch (buySellErr) {
                console.error('Buyback buy/sell ledger posting error:', buySellErr);
              }
            }
          }
          await connection.commit();
        } catch (deductionError) {
          try {
            await connection.rollback();
          } catch (_) {
            /* ignore */
          }
          console.error('Error processing face value deduction for approved buyback:', deductionError);
          // Don't fail the approval if deduction fails - log and continue
        } finally {
          connection.release();
        }
      }

      res.json({
        success: true,
        message: `Deal ${action || 'updated'} successfully`,
        data: {
          id,
          status,
          updated_by: userId,
          field
        }
      });

    } catch (error) {
      console.error('Error updating deal status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update deal status: ' + error.message
      });
    }
  },

  // Update deal data
  updateDeal: async (req, res) => {
    try {
      const { id } = req.params;
      const { leg1: rawLeg1, leg2: rawLeg2, fund_movement, sellDeals: rawSellDeals, source_buy_deal_number } = req.body;
      const { leg1, leg2, allocations: sellDeals } = syncLegFacesToAllocationSum(rawLeg1, rawLeg2, rawSellDeals);

      if (!leg1 || !leg2) {
        return res.status(400).json({
          success: false,
          error: 'Both leg1 and leg2 data are required'
        });
      }

      // Read-only/computed values must be populated; blank values must not be saved.
      const leg1ComputedError = validateComputedLegValues(leg1, 'Leg 1');
      if (leg1ComputedError) {
        return res.status(400).json({ success: false, error: leg1ComputedError });
      }
      const leg2ComputedError = validateComputedLegValues(leg2, 'Leg 2');
      if (leg2ComputedError) {
        return res.status(400).json({ success: false, error: leg2ComputedError });
      }

      // A Sell Leg 1 must carry buy-deal allocations from the sell holdings modal.
      const sellAllocationError = validateSellLegAllocations(leg1, sellDeals);
      if (sellAllocationError) {
        return res.status(400).json({ success: false, error: sellAllocationError });
      }

      // Only rejected deals are editable; edited deals are re-submitted for verification
      const existingDeal = await BuybackDeal.getById(id);
      if (!existingDeal) {
        return res.status(404).json({
          success: false,
          error: 'Buyback deal not found'
        });
      }

      if (String(existingDeal.deal_status || '').toLowerCase() !== 'rejected') {
        return res.status(400).json({
          success: false,
          error: 'Only rejected deals can be edited'
        });
      }

      // Reject allocations that would oversell a buy deal (excluding this deal's own
      // outstanding claim so an edit isn't double-counted).
      const availabilityError = await validateBuyDealAvailability(
        leg1,
        sellDeals,
        existingDeal.deal_number
      );
      if (availabilityError) {
        return res.status(400).json({ success: false, error: availabilityError });
      }

      // Holiday validation - check if updated transaction dates are holidays
      // Check both legs for holidays
      const currency1 = leg1.currency || 'LKR';
      const currency2 = leg2.currency || 'LKR';
      
      // Check leg1 dates
      const holidayValidation1 = await holidayValidationService.validateTransactionDates({
        tradeDate: leg1.tradeDate,
        valueDate: leg1.valueDate,
        currency: currency1
      });

      if (holidayValidation1.isHoliday) {
        return res.status(400).json({
          success: false,
          error: 'Transaction cannot be saved on a holiday',
          message: `Leg 1: ${holidayValidation1.message}`
        });
      }

      // Check leg2 dates
      const holidayValidation2 = await holidayValidationService.validateTransactionDates({
        tradeDate: leg2.tradeDate,
        valueDate: leg2.valueDate,
        currency: currency2
      });

      if (holidayValidation2.isHoliday) {
        return res.status(400).json({
          success: false,
          error: 'Transaction cannot be saved on a holiday',
          message: `Leg 2: ${holidayValidation2.message}`
        });
      }

      const dealData = {
        leg1: {
          tradeDate: leg1.tradeDate,
          valueDate: leg1.valueDate,
          transactionType: leg1.transactionType,
          isin: leg1.isin,
          counterparty: leg1.counterparty,
          broker: leg1.broker,
          portfolio: leg1.portfolio,
          strategy: leg1.strategy,
          custodian: leg1.custodian,
          settlementMode: leg1.settlementMode,
          brokerage: leg1.brokerage || 0,
          interestRate: leg1.interestRate || 0,
          faceValue: leg1.faceValue,
          adjustedFaceValue: leg1.adjustedFaceValue,
          yield: leg1.yield,
          settlementAmount: leg1.settlementAmount,
          cleanPrice: leg1.cleanPrice,
          dirtyPrice: leg1.dirtyPrice,
          accruedInterest: leg1.accruedInterest
        },
        leg2: {
          tradeDate: leg2.tradeDate,
          valueDate: leg2.valueDate,
          transactionType: leg2.transactionType,
          isin: leg2.isin,
          counterparty: leg2.counterparty,
          portfolio: leg2.portfolio,
          strategy: leg2.strategy,
          custodian: leg2.custodian,
          settlementMode: leg2.settlementMode,
          faceValue: leg2.faceValue,
          adjustedFaceValue: leg2.adjustedFaceValue,
          yield: leg2.yield,
          settlementAmount: leg2.settlementAmount,
          cleanPrice: leg2.cleanPrice,
          dirtyPrice: leg2.dirtyPrice,
          accruedInterest: leg2.accruedInterest
        },
        notes: req.body.notes,
        fund_movement: String(fund_movement || existingDeal.fund_movement || 'no').toLowerCase() === 'yes' ? 'yes' : 'no',
        // Re-submit edited rejected deals into the approval pipeline
        deal_status: 'Pending_Verification',
        source_buy_deal_number: source_buy_deal_number || null,
        // Persist per-deal allocations so the re-submitted deal keeps its buy-deal linkage
        sell_deal_allocations: Array.isArray(sellDeals) && sellDeals.length > 0
          ? sellDeals.map(d => ({
              deal_number: d.deal_number || d.buy_deal_number,
              amountToSell: Number(d.amountToSell) || 0
            }))
          : null
      };

      const result = await BuybackDeal.update(id, dealData);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          error: 'Buyback deal not found'
        });
      }

      res.json({
        success: true,
        message: 'Deal updated successfully'
      });

    } catch (error) {
      console.error('Error updating deal:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update deal: ' + error.message
      });
    }
  },

  // Delete deal
  deleteDeal: async (req, res) => {
    try {
      const { id } = req.params;
      const buybackIdNum = Number(id);
      const [buybackRows] = await db.query('SELECT * FROM buyback_deals WHERE id = ?', [id]);

      if (!buybackRows || buybackRows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Buyback deal not found'
        });
      }

      const buyback = buybackRows[0];

      const [buybackLinkColRows] = await db.query(
        `SELECT 1
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'gsec'
           AND COLUMN_NAME = 'buyback_deal_id'
         LIMIT 1`
      );
      const hasBuybackDealId = Array.isArray(buybackLinkColRows) && buybackLinkColRows.length > 0;

      // If this approved buyback deducted from source buy deals, restore those amounts on delete.
      if (buyback.deal_status === 'Approved' && buyback.leg1_transaction_type === 'Sell') {
        // Parse per-deal allocations stored at creation time
        let allocations = null;
        if (buyback.sell_deal_allocations) {
          try {
            allocations = typeof buyback.sell_deal_allocations === 'string'
              ? JSON.parse(buyback.sell_deal_allocations)
              : buyback.sell_deal_allocations;
          } catch (parseErr) {
            console.warn('Failed to parse sell_deal_allocations for restore, using legacy logic:', parseErr.message);
          }
        }

        if (allocations && Array.isArray(allocations) && allocations.length > 0) {
          // --- New path: restore exact allocated amount to each buy deal ---
          console.log(`Restoring allocations for deleted buyback ${buyback.deal_number} (${allocations.length} deal(s))`);

          for (const alloc of allocations) {
            const allocDealNumber = alloc.deal_number;
            const allocAmount = parseFloat(alloc.amountToSell || 0);

            if (!allocDealNumber || allocAmount <= 0) continue;

            const [rows] = await db.query(
              `SELECT id, deal_number, face_value, remaining_face_value
               FROM gsec
               WHERE deal_number = ? AND transaction_type = 'Buy'
               LIMIT 1`,
              [allocDealNumber]
            );

            if (!rows || rows.length === 0) {
              console.warn(`Buy deal ${allocDealNumber} not found for restore`);
              continue;
            }

            const buyDeal = rows[0];
            const maxFace = parseFloat(buyDeal.face_value || 0);
            const currentRemaining = buyDeal.remaining_face_value === null || buyDeal.remaining_face_value === undefined
              ? maxFace
              : parseFloat(buyDeal.remaining_face_value || 0);

            const roomToRestore = Math.max(0, maxFace - currentRemaining);
            const addBack = Math.min(allocAmount, roomToRestore);
            const restoredRemaining = Math.trunc((currentRemaining + addBack) * 10000) / 10000;

            await db.query(
              'UPDATE gsec SET remaining_face_value = ? WHERE id = ?',
              [restoredRemaining.toFixed(4), buyDeal.id]
            );
            await Gsec.syncFutureCouponCashflowsForBuyDeal(buyDeal.deal_number);

            console.log(
              `Restored ${addBack} to buy deal ${allocDealNumber} (id=${buyDeal.id}). New remaining: ${restoredRemaining}`
            );
          }
        } else {
          // --- Legacy fallback: use source_buy_deal_number or FIFO ---
          const restoreAmount = parseFloat(
            buyback.leg1_adjusted_face_value !== null && buyback.leg1_adjusted_face_value !== undefined
              ? buyback.leg1_adjusted_face_value
              : buyback.leg1_face_value || 0
          );
          const sourceBuyDealNumber = buyback.source_buy_deal_number;
          const isin = buyback.leg1_isin;
          const portfolio = buyback.leg1_portfolio;

          if (restoreAmount > 0 && isin && portfolio) {
            let candidateBuyDeals = [];

            if (sourceBuyDealNumber) {
              const [specificRows] = await db.query(
                `SELECT * FROM gsec
                 WHERE deal_number = ? AND transaction_type = 'Buy'
                 ORDER BY created_at ASC`,
                [sourceBuyDealNumber]
              );
              if (specificRows && specificRows.length > 0) {
                candidateBuyDeals = specificRows;
              }
            }

            if (candidateBuyDeals.length === 0) {
              const [fifoRows] = await db.query(
                `SELECT * FROM gsec
                 WHERE isin_number = ? AND portfolio = ? AND transaction_type = 'Buy'
                 ORDER BY created_at ASC`,
                [isin, portfolio]
              );
              candidateBuyDeals = fifoRows || [];
            }

            let remainingToRestore = restoreAmount;
            for (const buyDeal of candidateBuyDeals) {
              if (remainingToRestore <= 0) break;

              const maxFace = parseFloat(buyDeal.face_value || 0);
              const currentRemaining = buyDeal.remaining_face_value === null
                ? maxFace
                : parseFloat(buyDeal.remaining_face_value || 0);

              const roomToRestore = Math.max(0, maxFace - currentRemaining);
              if (roomToRestore <= 0) continue;

              const addBack = Math.min(remainingToRestore, roomToRestore);
              const restoredRemaining = Math.trunc((currentRemaining + addBack) * 10000) / 10000;

              await db.query(
                'UPDATE gsec SET remaining_face_value = ? WHERE id = ?',
                [restoredRemaining.toFixed(4), buyDeal.id]
              );
              await Gsec.syncFutureCouponCashflowsForBuyDeal(buyDeal.deal_number);

              remainingToRestore -= addBack;
            }

            if (remainingToRestore > 0) {
              console.warn(`Could not fully restore ${remainingToRestore} for deleted buyback ${buyback.deal_number}`);
            }
          }
        }
      }

      // Remove auto-created / letter GSec rows linked to this buyback
      if (hasBuybackDealId) {
        await db.query(`DELETE FROM gsec WHERE buyback_deal_id = ?`, [buybackIdNum]);
      } else if (buyback.leg2_transaction_type === 'Buy') {
        const leg2EffectiveFace = parseFloat(
          buyback.leg2_adjusted_face_value !== null && buyback.leg2_adjusted_face_value !== undefined
            ? buyback.leg2_adjusted_face_value
            : buyback.leg2_face_value
        ) || 0;
        await db.query(
          `DELETE FROM gsec
           WHERE transaction_type = 'Buy'
             AND isin_number = ?
             AND face_value = ?
             AND value_date = ?
             AND portfolio = ?`,
          [
            buyback.leg2_isin,
            leg2EffectiveFace,
            buyback.leg2_value_date,
            buyback.leg2_portfolio
          ]
        );
      }

      const result = await BuybackDeal.delete(id);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          error: 'Buyback deal not found'
        });
      }

      res.json({
        success: true,
        message: 'Deal deleted successfully'
      });

    } catch (error) {
      console.error('Error deleting deal:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete deal: ' + error.message
      });
    }
  }
};

module.exports = buybackDealController;
