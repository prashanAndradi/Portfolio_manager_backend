'use strict';

const db = require('../config/db');
const Notification = require('../models/notificationModel');
const emailService = require('../utils/emailService');
const DealerLimit = require('../models/dealerLimitModel');

// Per-product (today's-deals-by-this-user) sum, one small query per table.
// Column names differ per product (confirmed against each model while
// implementing): gsec.created_by/trade_date, tbill.user_id/trade_date,
// repo_deals.created_by/trade_date, buyback_deals.created_by/leg1_trade_date.
async function sumTodaysDeals(userId) {
  const queries = [
    `SELECT COALESCE(SUM(face_value), 0) AS total FROM gsec
       WHERE created_by = ? AND DATE(trade_date) = CURDATE() AND COALESCE(status, '') <> 'cancelled'`,
    `SELECT COALESCE(SUM(face_value), 0) AS total FROM tbill
       WHERE user_id = ? AND DATE(trade_date) = CURDATE() AND COALESCE(status, '') <> 'cancelled'`,
    `SELECT COALESCE(SUM(principal_amount), 0) AS total FROM repo_deals
       WHERE created_by = ? AND DATE(trade_date) = CURDATE() AND COALESCE(approval_status, '') <> 'rejected'`,
    `SELECT COALESCE(SUM(leg1_face_value), 0) AS total FROM buyback_deals
       WHERE created_by = ? AND DATE(leg1_trade_date) = CURDATE() AND COALESCE(deal_status, '') <> 'Rejected'`
  ];

  let total = 0;
  for (const sql of queries) {
    try {
      const [rows] = await db.query(sql, [userId]);
      total += Number(rows[0]?.total || 0);
    } catch (err) {
      // A single product's sum failing (e.g. schema drift) must not block
      // the check for the others, or the deal save itself.
      console.error('[dealerLimitCheckService] sumTodaysDeals query failed:', err.message);
    }
  }
  return total;
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

async function getUser(userId) {
  const [rows] = await db.query('SELECT id, username, email FROM users WHERE id = ?', [userId]);
  return rows[0] || null;
}

/**
 * Checks a deal's amount against the entering user's own dealer limit.
 * Never throws in a way that blocks the caller - callers should still wrap
 * this in try/catch, but every internal failure here is already caught and
 * treated as "no warning" so a bug in limit-checking can never block a save.
 *
 * @returns {Promise<{breached: boolean, message?: string, limit?: number, amount?: number}>}
 */
async function checkDealerLimitAndNotify({ userId, productType, dealNumber, amount, currency, counterpartyLabel }) {
  try {
    if (!userId || !amount || amount <= 0) return { breached: false };

    const limits = await DealerLimit.getByUser(userId, currency || 'LKR');
    if (!limits) return { breached: false };

    const perDealLimit = Number(limits.per_deal_limit || 0);
    const perDayLimit = Number(limits.per_day_limit || 0);

    const exceedsPerDeal = perDealLimit > 0 && amount > perDealLimit;
    let exceedsPerDay = false;
    let todayTotal = 0;
    if (perDayLimit > 0) {
      todayTotal = await sumTodaysDeals(userId);
      exceedsPerDay = (todayTotal + amount) > perDayLimit;
    }

    if (!exceedsPerDeal && !exceedsPerDay) return { breached: false };

    const limitType = exceedsPerDeal ? 'per-deal' : 'per-day';
    const limitValue = exceedsPerDeal ? perDealLimit : perDayLimit;
    const dealer = await getUser(userId);
    const dealerName = dealer?.username || `user #${userId}`;

    const message = `${dealerName} entered a ${productType} deal${dealNumber ? ` (${dealNumber})` : ''}${
      counterpartyLabel ? ` with ${counterpartyLabel}` : ''
    } for ${amount.toLocaleString()} which exceeds their ${limitType} dealer limit of ${limitValue.toLocaleString()}.`;

    // In-app notifications: the entering user + every middle-office assignee.
    const recipients = await getMiddleOfficeRecipients();
    const notifRows = [
      {
        user_id: userId,
        type: 'dealer_limit_breach',
        title: 'Your deal exceeded your dealer limit',
        message,
        deal_number: dealNumber || null,
        product_type: productType
      },
      ...recipients.map((r) => ({
        user_id: r.id,
        type: 'dealer_limit_breach',
        title: 'Dealer limit exceeded',
        message,
        deal_number: dealNumber || null,
        product_type: productType
      }))
    ];
    try {
      await Notification.createMany(notifRows);
    } catch (err) {
      console.error('[dealerLimitCheckService] Failed to write notifications:', err.message);
    }

    // Best-effort email, to the dealer and every middle-office recipient with an email on file.
    const emailDetails = {
      dealerUsername: dealerName,
      dealNumber,
      productType,
      amount: amount.toLocaleString(),
      limit: limitValue.toLocaleString(),
      limitType
    };
    const emailTargets = [dealer, ...recipients].filter((u) => u && u.email);
    for (const target of emailTargets) {
      try {
        await emailService.sendLimitBreachEmail(target.email, emailDetails);
      } catch (err) {
        console.error('[dealerLimitCheckService] Failed to email', target.email, err.message);
      }
    }

    return { breached: true, message, limit: limitValue, amount, limitType };
  } catch (err) {
    console.error('[dealerLimitCheckService] checkDealerLimitAndNotify failed:', err.message);
    return { breached: false };
  }
}

module.exports = { checkDealerLimitAndNotify };
