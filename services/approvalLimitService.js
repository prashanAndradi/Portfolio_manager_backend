'use strict';

const db = require('../config/db');
const Notification = require('../models/notificationModel');

async function findEligibleApprovers({ requiredRoles, dealAmount }) {
  if (!requiredRoles || !requiredRoles.length) return [];
  const placeholders = requiredRoles.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT u.id, u.username, aa.per_deal_limit
     FROM authorizer_assignments aa
     JOIN users u ON u.id = aa.user_id
     WHERE aa.role IN (${placeholders})
       AND (aa.per_deal_limit = 0 OR aa.per_deal_limit >= ?)`,
    [...requiredRoles, dealAmount]
  );
  return rows.map((r) => ({ id: r.id, username: r.username, per_deal_limit: Number(r.per_deal_limit) }));
}

async function getMiddleOfficeRecipients() {
  const [rows] = await db.query(`
    SELECT DISTINCT u.id, u.username
    FROM authorizer_assignments aa
    JOIN users u ON u.id = aa.user_id
    WHERE aa.role LIKE 'middle_office_%'
  `);
  return rows;
}

/**
 * Checks whether `actor` has enough of their own configured per_deal_limit
 * to approve a deal at its current stage. Returns { ok: true } when they do
 * (or when the check doesn't apply - admin, no assignment, no limit
 * configured). When they don't, returns { ok: false, message, yourLimit,
 * dealAmount, eligibleApprovers } - eligibleApprovers lists other assignees
 * at the same stage whose own limit *does* cover this deal, so the caller
 * knows who to escalate to instead of just hitting a dead end.
 *
 * The block/allow decision itself is computed synchronously from
 * `actor.assignments` (already loaded, no DB call, no failure surface).
 * Everything after that - finding eligible approvers, notifying Middle
 * Office - is enrichment and is wrapped separately so a failure there can
 * never flip a genuine block into a false allow.
 */
async function checkApprovalLimit({ actor, requiredRoles, dealAmount, dealNumber, productType, stageKey }) {
  if (!actor || actor.isAdmin) return { ok: true };
  const myAssignment = (actor.assignments || []).find((a) => requiredRoles.includes(a.role));
  const myLimit = Number(myAssignment?.per_deal_limit || 0);
  if (!myAssignment || myLimit <= 0 || dealAmount <= myLimit) {
    return { ok: true };
  }

  let eligibleApprovers = [];
  const message = `Your approval limit (${myLimit.toLocaleString()}) is insufficient for this deal (${dealAmount.toLocaleString()}).`;
  try {
    eligibleApprovers = (await findEligibleApprovers({ requiredRoles, dealAmount }))
      .filter((a) => a.id !== actor.id);

    const notifyMessage = `${actor.username}'s approval limit (${myLimit.toLocaleString()}) is insufficient for ` +
      `${productType} deal${dealNumber ? ` ${dealNumber}` : ''} (${dealAmount.toLocaleString()}) at the ${stageKey} stage.` +
      (eligibleApprovers.length
        ? ` Eligible approver(s): ${eligibleApprovers.map((a) => a.username).join(', ')}.`
        : ' No other assigned approver currently has a sufficient limit - the limit may need to be raised.');

    const recipients = await getMiddleOfficeRecipients();
    await Notification.createMany(recipients.map((r) => ({
      user_id: r.id,
      type: 'approval_limit_exceeded',
      title: 'Deal stuck: approver limit exceeded',
      message: notifyMessage,
      deal_number: dealNumber || null,
      product_type: productType
    })));
  } catch (err) {
    console.error('[approvalLimitService] Enrichment (eligible approvers / notify) failed:', err.message);
  }

  return { ok: false, message, yourLimit: myLimit, dealAmount, eligibleApprovers };
}

module.exports = { checkApprovalLimit, findEligibleApprovers };
