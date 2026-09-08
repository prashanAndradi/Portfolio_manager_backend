const DealerLimit = require('../models/dealerLimitModel');
const Notification = require('../models/notificationModel');
const db = require('../config/db');
const { getMiddleOfficeTier } = require('../utils/workflowStageAuth');

async function getMiddleOfficeApproverRecipients() {
  const [rows] = await db.query(`
    SELECT DISTINCT u.id, u.username
    FROM authorizer_assignments aa
    JOIN users u ON u.id = aa.user_id
    WHERE aa.role IN ('middle_office_officer', 'middle_office_manager')
  `);
  return rows;
}

exports.getAll = async (req, res) => {
  try {
    const results = await DealerLimit.getAll();
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
};

exports.getPending = async (req, res) => {
  try {
    const results = await DealerLimit.getPendingApprovals();
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
};

// Officer/manager's own edits apply immediately. A plain middle_office_user's
// submission is staged as a pending proposal instead, and every officer/
// manager gets notified to review it.
exports.createOrUpdate = async (req, res) => {
  try {
    const { user_id, per_deal_limit, per_day_limit, currency } = req.body;
    if (!user_id) {
      return res.status(400).json({ success: false, error: 'user_id is required' });
    }

    const actor = req.actor;
    const tier = getMiddleOfficeTier(actor);

    if (!actor.isAdmin && tier === 'middle_office_user') {
      const result = await DealerLimit.proposeChange({
        user_id, per_deal_limit, per_day_limit, currency, proposed_by: actor.id
      });

      try {
        const recipients = await getMiddleOfficeApproverRecipients();
        const [targetUserRows] = await db.query('SELECT username FROM users WHERE id = ?', [user_id]);
        const targetUsername = targetUserRows[0]?.username || `user #${user_id}`;
        const message = `${actor.username} proposed a dealer limit change for ${targetUsername} ` +
          `(per-deal: ${per_deal_limit || 0}, per-day: ${per_day_limit || 0}) awaiting your approval.`;
        await Notification.createMany(recipients.map((r) => ({
          user_id: r.id,
          type: 'dealer_limit_proposal',
          title: 'Dealer limit change awaiting approval',
          message,
          product_type: 'dealer_limit'
        })));
      } catch (notifyErr) {
        console.error('[dealerLimitController] Failed to notify approvers:', notifyErr.message);
      }

      return res.status(201).json({ success: true, data: result, pendingApproval: true });
    }

    const result = await DealerLimit.createOrUpdate({ user_id, per_deal_limit, per_day_limit, currency });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
};

exports.approve = async (req, res) => {
  try {
    const { id } = req.params;
    const actor = req.actor;

    const row = await DealerLimit.getById(id);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Dealer limit not found' });
    }
    if (row.pending_per_deal_limit === null && row.pending_per_day_limit === null) {
      return res.status(400).json({ success: false, error: 'This dealer limit has no pending proposal to approve' });
    }

    const result = await DealerLimit.approveChange(id, actor.id);
    if (result.affectedRows === 0) {
      return res.status(400).json({ success: false, error: 'Nothing to approve (already resolved by someone else)' });
    }

    try {
      if (row.proposed_by) {
        await Notification.create({
          user_id: row.proposed_by,
          type: 'dealer_limit_approved',
          title: 'Your dealer limit proposal was approved',
          message: `${actor.username} approved your proposed dealer limit change (per-deal: ${row.pending_per_deal_limit}, per-day: ${row.pending_per_day_limit}).`,
          product_type: 'dealer_limit'
        });
      }
    } catch (notifyErr) {
      console.error('[dealerLimitController] Failed to notify proposer of approval:', notifyErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
};

exports.reject = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const actor = req.actor;

    const row = await DealerLimit.getById(id);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Dealer limit not found' });
    }
    if (row.pending_per_deal_limit === null && row.pending_per_day_limit === null) {
      return res.status(400).json({ success: false, error: 'This dealer limit has no pending proposal to reject' });
    }

    const result = await DealerLimit.rejectChange(id, actor.id, reason);
    if (result.affectedRows === 0) {
      return res.status(400).json({ success: false, error: 'Nothing to reject (already resolved by someone else)' });
    }

    try {
      if (row.proposed_by) {
        await Notification.create({
          user_id: row.proposed_by,
          type: 'dealer_limit_rejected',
          title: 'Your dealer limit proposal was rejected',
          message: `${actor.username} rejected your proposed dealer limit change${reason ? `: ${reason}` : '.'}`,
          product_type: 'dealer_limit'
        });
      }
    } catch (notifyErr) {
      console.error('[dealerLimitController] Failed to notify proposer of rejection:', notifyErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
};

exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await DealerLimit.delete(id);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Dealer limit not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
};
