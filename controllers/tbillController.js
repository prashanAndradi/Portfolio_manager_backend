const db = require('../config/db');
const Tbill = require('../models/tbillModel');
const tbillPricing = require('../services/tbillPricingService');
const { resolveEffectiveWorkflowAuth } = require('../utils/effectiveWorkflowAuth');
const { resolveRequestUserId } = require('../utils/requestUser');
const { actorCanActAtStage, requiredRolesForStage } = require('../utils/workflowStageAuth');
const { checkDealerLimitAndNotify } = require('../services/dealerLimitCheckService');
const { checkApprovalLimit } = require('../services/approvalLimitService');

function normalizeTransactionType(body) {
  return String(body.transactionType || body.transaction_type || 'Buy');
}

function buildPricedPayload(body, faceValueOverride) {
  const {
    tradeDate,
    valueDate,
    maturityDate,
    faceValue,
    yield: yieldField,
    discountRatePercent
  } = body;

  const fv = faceValueOverride != null ? faceValueOverride : faceValue;
  const ratePct = discountRatePercent != null ? discountRatePercent : yieldField;

  const priced = tbillPricing.compute({
    valueDate,
    maturityDate,
    faceValue: fv,
    discountRatePercent: ratePct
  });

  if (!priced.ok) {
    return { ok: false, error: priced.error || 'Pricing validation failed' };
  }

  return {
    ok: true,
    payload: {
      ...body,
      faceValue: fv,
      daysToMaturity: priced.days,
      pricePer100: priced.pricePer100,
      settlementAmount: priced.cashPrice,
      cleanPrice: priced.pricePer100,
      dirtyPrice: priced.pricePer100,
      discountRatePercent: ratePct,
      tradeDate: tradeDate || valueDate,
      status: 'pending',
      current_approval_level: 'front_office'
    }
  };
}

exports.create = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const body = req.body || {};
    const transactionType = normalizeTransactionType(body);
    const { sell_deals: sellDeals } = body;

    const {
      valueDate,
      maturityDate,
      faceValue,
      yield: yieldField,
      discountRatePercent
    } = body;

    if (!valueDate || !maturityDate || (yieldField == null && discountRatePercent == null)) {
      return res.status(400).json({
        success: false,
        message: 'valueDate, maturityDate, and yield (discount rate %) are required'
      });
    }

    await connection.beginTransaction();

    if (Array.isArray(sellDeals) && sellDeals.length > 0 && transactionType.toLowerCase() === 'sell') {
      let firstResult = null;
      const created = [];

      for (let sell of sellDeals) {
        // Resolve buy_deal_number from the numeric id fallback when it is null/empty
        // (deals created before deal_number generation was added may have null deal_number)
        if (!sell?.buy_deal_number && (sell?.buy_deal_id || sell?.id)) {
          const buyId = sell.buy_deal_id || sell.id;
          const [rows] = await connection.query(
            'SELECT id, deal_number FROM tbill WHERE id = ? AND transaction_type = "Buy"',
            [buyId]
          );
          if (rows[0]) {
            sell = { ...sell, buy_deal_number: rows[0].deal_number, _resolved_id: rows[0].id };
          }
        }

        if (!sell?.buy_deal_number && !sell?._resolved_id) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: 'Invalid sell_deals payload: buy_deal_number is required for each sell leg'
          });
        }

        const amountToSell = parseFloat(sell.amountToSell);
        if (!Number.isFinite(amountToSell) || amountToSell <= 0) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: `Invalid sell amount for buy deal ${sell.buy_deal_number || sell._resolved_id}`
          });
        }

        const priced = buildPricedPayload(body, amountToSell);
        if (!priced.ok) {
          await connection.rollback();
          return res.status(400).json({ success: false, message: priced.error });
        }

        const legPayload = {
          ...priced.payload,
          dealNumber: null,
          transactionType: 'Sell',
          buyDealNumber: sell.buy_deal_number || null,
          portfolio: sell.portfolio || body.portfolio
        };

        const result = await Tbill.createWithConnection(legPayload, connection);
        if (!firstResult) firstResult = result;

        await Tbill.updateBuyRemainingFaceValue(
          sell.buy_deal_number || null,
          amountToSell,
          connection,
          sell._resolved_id || null
        );

        created.push({
          id: result.insertId,
          deal_number: result.dealNumber,
          buy_deal_number: sell.buy_deal_number || null,
          amountToSell
        });
      }

      await connection.commit();

      let limitWarning = null;
      try {
        const dealerId = body.userId || resolveRequestUserId(req);
        const totalAmount = created.reduce((sum, c) => sum + (Number(c.amountToSell) || 0), 0);
        const check = await checkDealerLimitAndNotify({
          userId: dealerId,
          productType: 'tbill',
          dealNumber: firstResult?.dealNumber || null,
          amount: totalAmount,
          currency: body.currency || 'LKR'
        });
        if (check.breached) limitWarning = { message: check.message, limit: check.limit, amount: check.amount };
      } catch (limitErr) {
        console.error('[tbill create] Dealer limit check failed (non-fatal):', limitErr.message);
      }

      return res.status(201).json({
        success: true,
        message: `Created ${created.length} T-Bill sell transaction(s)`,
        data: {
          id: firstResult?.insertId,
          deal_number: firstResult?.dealNumber,
          dealNumber: firstResult?.dealNumber,
          legs: created
        },
        limitWarning
      });
    }

    if (transactionType.toLowerCase() === 'sell') {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Sell transactions require sell_deals from the holdings picker'
      });
    }

    if (!faceValue) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'faceValue is required for Buy transactions'
      });
    }

    const priced = buildPricedPayload(body);
    if (!priced.ok) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: priced.error });
    }

    const { insertId, dealNumber } = await Tbill.createWithConnection(priced.payload, connection);
    await connection.commit();

    let limitWarning = null;
    try {
      const dealerId = body.userId || resolveRequestUserId(req);
      const check = await checkDealerLimitAndNotify({
        userId: dealerId,
        productType: 'tbill',
        dealNumber,
        amount: parseFloat(faceValue) || 0,
        currency: body.currency || 'LKR'
      });
      if (check.breached) limitWarning = { message: check.message, limit: check.limit, amount: check.amount };
    } catch (limitErr) {
      console.error('[tbill create] Dealer limit check failed (non-fatal):', limitErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'T-Bill deal saved',
      data: { id: insertId, deal_number: dealNumber, dealNumber },
      limitWarning
    });
  } catch (err) {
    try {
      await connection.rollback();
    } catch (_) {
      /* ignore */
    }
    console.error('tbill create error:', err);
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Failed to save T-Bill deal'
    });
  } finally {
    connection.release();
  }
};

exports.getBuyDealsWithBalance = async (req, res) => {
  try {
    const { isin, portfolio, asAtDate } = req.query;
    const deals = await Tbill.getBuyDealsWithBalance(isin, portfolio, asAtDate || null);
    return res.json({ success: true, data: deals });
  } catch (err) {
    console.error('tbill getBuyDealsWithBalance error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to fetch T-Bill buy deals'
    });
  }
};

exports.getRecent = async (req, res) => {
  try {
    const transactions = await Tbill.getRecent();
    return res.json({ success: true, data: transactions });
  } catch (err) {
    console.error('tbill getRecent error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to fetch T-Bill transactions'
    });
  }
};

exports.updateStatus = async (req, res) => {
  const id = req.params.id;
  const { status, comment } = req.body || {};

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid status. Must be approved or rejected.'
    });
  }

  try {
    const existing = await Tbill.getById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    // Only the role that owns the deal's CURRENT stage may advance or reject
    // it - same gap and same fix as GSEC/buyback: Tbill.updateStatus always
    // advances exactly one tier server-side, but without this check any
    // authenticated caller could approve a deal through all three tiers alone.
    const actor = await resolveEffectiveWorkflowAuth(resolveRequestUserId(req));
    if (!actor) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!actor.isAdmin && !actor.allowedTabs.includes('fixed_income_tbill')) {
      return res.status(403).json({ success: false, message: 'Access denied: T-Bill not assigned' });
    }
    const currentLevel = existing.current_approval_level || 'front_office';
    if (!actorCanActAtStage(actor, currentLevel)) {
      return res.status(403).json({
        success: false,
        message: `Access denied: role required for the ${currentLevel} stage.`
      });
    }

    // An authorizer needs enough of their OWN configured limit to advance a
    // deal (rejecting never needs it - only "proceeding" does).
    if (status === 'approved') {
      const limitCheck = await checkApprovalLimit({
        actor,
        requiredRoles: requiredRolesForStage(currentLevel),
        dealAmount: Number(existing.face_value) || 0,
        dealNumber: existing.deal_number,
        productType: 'tbill',
        stageKey: currentLevel
      });
      if (!limitCheck.ok) {
        return res.status(403).json({
          success: false,
          limitExceeded: true,
          message: limitCheck.message,
          yourLimit: limitCheck.yourLimit,
          dealAmount: limitCheck.dealAmount,
          eligibleApprovers: limitCheck.eligibleApprovers
        });
      }
    }

    const updateData = {
      status,
      authorized_by: String(actor.id)
    };

    if (status === 'rejected' && typeof comment === 'string') {
      updateData.comment = comment;
    } else if (status === 'approved') {
      updateData.comment = null;
    }

    const result = await Tbill.updateStatus(id, updateData);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    return res.json({
      success: true,
      message: `Transaction ${status} successfully`,
      data: {
        status: result.status,
        current_approval_level: result.current_approval_level
      }
    });
  } catch (err) {
    console.error('tbill updateStatus error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to update T-Bill status'
    });
  }
};

exports.update = async (req, res) => {
  const id = req.params.id;
  const body = req.body || {};

  try {
    const existing = await Tbill.getById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const valueDate = body.valueDate || body.value_date || existing.value_date;
    const maturityDate = body.maturityDate || body.maturity_date || existing.maturity_date;
    const faceValue = body.faceValue ?? body.face_value ?? existing.face_value;
    const ratePct =
      body.discountRatePercent ??
      body.yield ??
      body.discount_rate_pct ??
      existing.discount_rate_pct;

    if (valueDate && maturityDate && faceValue != null && ratePct != null) {
      const priced = tbillPricing.compute({
        valueDate,
        maturityDate,
        faceValue,
        discountRatePercent: ratePct
      });

      if (!priced.ok) {
        return res.status(400).json({ success: false, message: priced.error || 'Pricing validation failed' });
      }

      body.daysToMaturity = priced.days;
      body.pricePer100 = priced.pricePer100;
      body.settlementAmount = priced.cashPrice;
      body.cleanPrice = priced.pricePer100;
      body.dirtyPrice = priced.pricePer100;
      body.discountRatePercent = ratePct;
    }

    const updatePayload = {
      ...body,
      status: body.status || 'pending',
      current_approval_level: body.current_approval_level || body.currentApprovalLevel || 'front_office'
    };

    const result = await Tbill.update(id, updatePayload);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    return res.json({
      success: true,
      message: 'T-Bill transaction updated successfully'
    });
  } catch (err) {
    console.error('tbill update error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to update T-Bill transaction'
    });
  }
};
