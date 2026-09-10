'use strict';

const db = require('../config/db');
const Notification = require('../models/notificationModel');
const emailService = require('../utils/emailService');
const LimitSetup = require('../models/limitSetupModel');

// Counterparties are stored prefix-coded in the product tables: 'i82' is
// individual #82, 'c32' corporate #32, 'j5' joint #5 (confirmed against the
// data). counterparty_limits stores the id and type separately, so we rebuild
// the code to match.
const TYPE_PREFIX = { individual: 'i', corporate: 'c', joint: 'j' };

// Which limit column each product is measured against. T-Bill has no
// dedicated column in counterparty_limits, so it only counts toward the
// overall exposure limit.
const PRODUCT_LIMIT_FIELD = {
  gsec: 'product_gsec_limit',
  tbill: null,
  repo: 'product_repo_limit',
  reverse_repo: 'product_reverse_repo_limit',
  buyback: 'product_sell_and_buy_back_limit',
  money_market: 'product_money_market_limit'
};

/**
 * Existing exposure for one counterparty, per product plus a total.
 *
 * Note on repo: repo_deals.counterparty_id is a plain int with no type
 * prefix, so a repo deal cannot be attributed to a counterparty *type*.
 * repoDealModel's own read path has the same limitation - it LEFT JOINs all
 * three counterparty tables on that one id. We follow the same convention
 * here, which means repo exposure is matched on id alone.
 *
 * Amounts are not filtered by currency: the product tables store currency
 * inconsistently, and almost all deals are LKR. The limit row itself is
 * currency-scoped, so this over-counts only in genuinely multi-currency books.
 */
async function sumCounterpartyExposure(counterpartyId, counterpartyType) {
  const code = `${TYPE_PREFIX[counterpartyType] || ''}${counterpartyId}`;
  const byProduct = { gsec: 0, tbill: 0, repo: 0, reverse_repo: 0, buyback: 0 };

  const queries = [
    ['gsec', `SELECT COALESCE(SUM(face_value), 0) AS total FROM gsec
                WHERE counterparty_id = ? AND COALESCE(status, '') <> 'cancelled'`, code],
    ['tbill', `SELECT COALESCE(SUM(face_value), 0) AS total FROM tbill
                 WHERE counterparty = ? AND COALESCE(status, '') <> 'cancelled'`, code],
    ['buyback', `SELECT COALESCE(SUM(leg1_face_value), 0) AS total FROM buyback_deals
                   WHERE leg1_counterparty = ? AND COALESCE(deal_status, '') <> 'Rejected'`, code],
    ['repo', `SELECT COALESCE(SUM(principal_amount), 0) AS total FROM repo_deals
                WHERE counterparty_id = ? AND COALESCE(deal_type, '') = 'Repo'
                  AND COALESCE(approval_status, '') <> 'rejected'`, counterpartyId],
    ['reverse_repo', `SELECT COALESCE(SUM(principal_amount), 0) AS total FROM repo_deals
                        WHERE counterparty_id = ? AND COALESCE(deal_type, '') = 'Reverse Repo'
                          AND COALESCE(approval_status, '') <> 'rejected'`, counterpartyId]
  ];

  for (const [key, sql, param] of queries) {
    try {
      const [rows] = await db.query(sql, [param]);
      byProduct[key] = Number(rows[0]?.total || 0);
    } catch (err) {
      // One product's sum failing must never block the check for the others,
      // nor the deal save itself.
      console.error(`[counterpartyLimitCheckService] ${key} exposure query failed:`, err.message);
    }
  }

  const total = Object.values(byProduct).reduce((a, b) => a + b, 0);
  return { byProduct, total };
}

async function getMiddleOfficeRecipients() {
  const [rows] = await db.query(`
    SELECT DISTINCT u.id, u.username, u.email
    FROM authorizer_assignments aa
    JOIN users u ON u.id = aa.user_id
    WHERE aa.role LIKE 'middle_office_%'
  `);
  return rows;
}

async function counterpartyName(counterpartyId, counterpartyType) {
  const tableByType = {
    individual: 'counterparty_master_individual',
    joint: 'counterparty_master_joint',
    corporate: 'counterparty_master_corporate'
  };
  const table = tableByType[counterpartyType];
  if (!table) return `counterparty #${counterpartyId}`;
  try {
    const [rows] = await db.query(`SELECT short_name FROM ${table} WHERE id = ? LIMIT 1`, [counterpartyId]);
    return rows[0]?.short_name || `counterparty #${counterpartyId}`;
  } catch {
    return `counterparty #${counterpartyId}`;
  }
}

/**
 * Checks a deal against the counterparty's configured exposure limits and, on
 * a breach, notifies the entering user and every Middle Office assignee.
 *
 * Advisory only - mirrors the dealer-limit check: it never blocks the save,
 * and every internal failure is swallowed and treated as "no breach" so a bug
 * in limit-checking can't stop a deal being booked.
 *
 * @returns {Promise<{breached: boolean, message?: string, limitType?: string,
 *                    limit?: number, exposure?: number, amount?: number}>}
 */
async function checkCounterpartyLimitAndNotify({
  counterpartyId, counterpartyType, productType, dealNumber, amount, currency, userId
}) {
  try {
    const numericAmount = Number(amount);
    if (!counterpartyId || !counterpartyType || !numericAmount || numericAmount <= 0) {
      return { breached: false };
    }

    const limits = await LimitSetup.getLimitsByCounterparty(
      counterpartyId, counterpartyType, currency || 'LKR'
    );
    // No limits configured for this counterparty means unlimited, matching the
    // existing convention in limitSetupModel.checkTransactionLimit.
    if (!limits) return { breached: false };

    const overallLimit = Number(limits.overall_exposure_limit || 0);
    const productField = PRODUCT_LIMIT_FIELD[productType];
    const productLimit = productField ? Number(limits[productField] || 0) : 0;

    // Only pay for the exposure queries if at least one limit is set.
    if (overallLimit <= 0 && productLimit <= 0) return { breached: false };

    const { byProduct, total } = await sumCounterpartyExposure(counterpartyId, counterpartyType);
    const newProductExposure = (byProduct[productType] || 0) + numericAmount;
    const newOverallExposure = total + numericAmount;

    const exceedsProduct = productLimit > 0 && newProductExposure > productLimit;
    const exceedsOverall = overallLimit > 0 && newOverallExposure > overallLimit;
    if (!exceedsProduct && !exceedsOverall) return { breached: false };

    const limitType = exceedsProduct ? `${productType} product` : 'overall exposure';
    const limitValue = exceedsProduct ? productLimit : overallLimit;
    const exposureValue = exceedsProduct ? newProductExposure : newOverallExposure;

    const cpName = await counterpartyName(counterpartyId, counterpartyType);
    const message =
      `A ${productType} deal${dealNumber ? ` (${dealNumber})` : ''} for ${numericAmount.toLocaleString()} ` +
      `takes ${cpName} to ${exposureValue.toLocaleString()}, which exceeds the approved ` +
      `${limitType} limit of ${limitValue.toLocaleString()}.`;

    const recipients = await getMiddleOfficeRecipients();
    const notifRows = recipients.map((r) => ({
      user_id: r.id,
      type: 'counterparty_limit_breach',
      title: 'Counterparty limit exceeded',
      message,
      deal_number: dealNumber || null,
      product_type: productType
    }));
    // The dealer who entered it should see it too, if we know who that was.
    if (userId) {
      notifRows.push({
        user_id: userId,
        type: 'counterparty_limit_breach',
        title: 'Deal exceeded the counterparty limit',
        message,
        deal_number: dealNumber || null,
        product_type: productType
      });
    }

    try {
      await Notification.createMany(notifRows);
    } catch (err) {
      console.error('[counterpartyLimitCheckService] Failed to write notifications:', err.message);
    }

    // Best-effort email to every Middle Office recipient with an address.
    const emailDetails = {
      dealerUsername: cpName,
      dealNumber,
      productType,
      amount: numericAmount.toLocaleString(),
      limit: limitValue.toLocaleString(),
      limitType
    };
    for (const target of recipients.filter((u) => u && u.email)) {
      try {
        await emailService.sendLimitBreachEmail(target.email, emailDetails);
      } catch (err) {
        console.error('[counterpartyLimitCheckService] Failed to email', target.email, err.message);
      }
    }

    return {
      breached: true,
      message,
      limitType,
      limit: limitValue,
      exposure: exposureValue,
      amount: numericAmount
    };
  } catch (err) {
    console.error('[counterpartyLimitCheckService] check failed:', err.message);
    return { breached: false };
  }
}

/**
 * Splits a prefix-coded counterparty ('i82', 'c32', 'j5') into the id and
 * type that counterparty_limits stores separately. Returns null for anything
 * that isn't in that form, so callers can skip the check rather than guess.
 */
function parseCounterpartyCode(value) {
  const match = String(value || '').trim().match(/^([icj])(\d+)$/i);
  if (!match) return null;
  const type = { i: 'individual', c: 'corporate', j: 'joint' }[match[1].toLowerCase()];
  return { counterpartyId: Number(match[2]), counterpartyType: type };
}

module.exports = { checkCounterpartyLimitAndNotify, sumCounterpartyExposure, parseCounterpartyCode };
