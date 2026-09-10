const LimitSetup = require('../models/limitSetupModel');
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

// Resolves a readable counterparty name for notification text. Best-effort:
// the name is cosmetic, so a lookup failure must not block the workflow.
async function counterpartyLabel(counterpartyId, counterpartyType) {
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
  } catch (err) {
    return `counterparty #${counterpartyId}`;
  }
}

exports.getAllCounterparties = async (req, res) => {
  try {
    const results = await LimitSetup.getAllCounterparties();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};

// Officer/manager (and admin) submissions apply immediately. A plain
// middle_office_user's submission is staged as a pending proposal instead,
// and every officer/manager is notified to review it.
exports.createLimit = async (req, res) => {
  try {
    const actor = req.actor;
    const tier = getMiddleOfficeTier(actor);
    const { counterparty_id, counterparty_type } = req.body;

    if (!counterparty_id || !counterparty_type) {
      return res.status(400).json({ error: 'counterparty_id and counterparty_type are required' });
    }

    if (!actor.isAdmin && tier === 'middle_office_user') {
      const result = await LimitSetup.proposeLimit({
        counterparty_id,
        counterparty_type,
        payload: req.body,
        proposed_by: actor.id
      });

      try {
        const recipients = await getMiddleOfficeApproverRecipients();
        const label = await counterpartyLabel(counterparty_id, counterparty_type);
        const message = `${actor.username} proposed a counterparty limit setup for ${label} ` +
          `(overall exposure: ${req.body.overall_exposure_limit || 0}) awaiting your approval.`;
        await Notification.createMany(recipients.map((r) => ({
          user_id: r.id,
          type: 'counterparty_limit_proposal',
          title: 'Counterparty limit awaiting approval',
          message,
          product_type: 'counterparty_limit'
        })));
      } catch (notifyErr) {
        console.error('[limitSetupController] Failed to notify approvers:', notifyErr.message);
      }

      return res.status(201).json({ id: result.insertId, pendingApproval: true });
    }

    const result = await LimitSetup.create(req.body);
    res.status(201).json({ id: result.insertId, ...req.body });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};

// Request blotter. Officers/managers/admin see every request; a plain
// middle_office_user sees only the ones they submitted.
exports.getRequests = async (req, res) => {
  try {
    const actor = req.actor;
    const tier = getMiddleOfficeTier(actor);
    const scopeToSelf = !actor.isAdmin && tier === 'middle_office_user';
    const results = await LimitSetup.getProposals({
      status: req.query.status,
      proposedBy: scopeToSelf ? actor.id : undefined
    });
    res.json({ success: true, data: results, scopedToSelf: scopeToSelf });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
};

exports.getPending = async (req, res) => {
  try {
    const results = await LimitSetup.getPendingProposals();
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
};

exports.approve = async (req, res) => {
  try {
    const { id } = req.params;
    const actor = req.actor;

    const proposal = await LimitSetup.getProposalById(id);
    if (!proposal) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }
    if (proposal.status !== 'pending') {
      return res.status(400).json({ success: false, error: `Proposal is already ${proposal.status}` });
    }

    // Insert the real limit first, then mark the proposal approved. The mark
    // is guarded on status='pending', so if another approver got there first
    // we roll back the insert we just made rather than leaving a duplicate.
    const created = await LimitSetup.create(proposal.payload);
    const marked = await LimitSetup.markProposalApproved(id, actor.id, created.insertId);
    if (marked.affectedRows === 0) {
      await db.query('DELETE FROM counterparty_limits WHERE id = ?', [created.insertId]);
      return res.status(400).json({ success: false, error: 'Nothing to approve (already resolved by someone else)' });
    }

    try {
      if (proposal.proposed_by) {
        const label = await counterpartyLabel(proposal.counterparty_id, proposal.counterparty_type);
        await Notification.create({
          user_id: proposal.proposed_by,
          type: 'counterparty_limit_approved',
          title: 'Your counterparty limit proposal was approved',
          message: `${actor.username} approved your proposed limit setup for ${label}.`,
          product_type: 'counterparty_limit'
        });
      }
    } catch (notifyErr) {
      console.error('[limitSetupController] Failed to notify proposer of approval:', notifyErr.message);
    }

    res.json({ success: true, id: created.insertId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
};

exports.reject = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const actor = req.actor;

    const proposal = await LimitSetup.getProposalById(id);
    if (!proposal) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }
    if (proposal.status !== 'pending') {
      return res.status(400).json({ success: false, error: `Proposal is already ${proposal.status}` });
    }

    const result = await LimitSetup.markProposalRejected(id, actor.id, reason);
    if (result.affectedRows === 0) {
      return res.status(400).json({ success: false, error: 'Nothing to reject (already resolved by someone else)' });
    }

    try {
      if (proposal.proposed_by) {
        const label = await counterpartyLabel(proposal.counterparty_id, proposal.counterparty_type);
        await Notification.create({
          user_id: proposal.proposed_by,
          type: 'counterparty_limit_rejected',
          title: 'Your counterparty limit proposal was rejected',
          message: `${actor.username} rejected your proposed limit setup for ${label}${reason ? `: ${reason}` : '.'}`,
          product_type: 'counterparty_limit'
        });
      }
    } catch (notifyErr) {
      console.error('[limitSetupController] Failed to notify proposer of rejection:', notifyErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
};
