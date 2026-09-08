const { resolveEffectiveWorkflowAuth } = require('../utils/effectiveWorkflowAuth');
const { resolveRequestUserId } = require('../utils/requestUser');
const { isMiddleOffice, isMiddleOfficeApprover } = require('../utils/workflowStageAuth');

// Shared guard for setup/admin endpoints that are exclusive to Middle Office
// tiers (or admin) - e.g. counterparty master mutations, dealer limits.
// Must run AFTER checkAuth so req.user is populated.
async function requireMiddleOffice(req, res, next) {
  try {
    const actor = await resolveEffectiveWorkflowAuth(resolveRequestUserId(req));
    if (!actor) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (!isMiddleOffice(actor)) {
      return res.status(403).json({ success: false, error: 'Access denied: Middle Office role required' });
    }
    req.actor = actor;
    next();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
}

// Stricter guard for approving/rejecting dealer-limit proposals: only
// middle_office_officer / middle_office_manager (or admin) - a plain
// middle_office_user cannot approve its own or anyone else's proposal.
async function requireMiddleOfficeApprover(req, res, next) {
  try {
    const actor = await resolveEffectiveWorkflowAuth(resolveRequestUserId(req));
    if (!actor) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (!isMiddleOfficeApprover(actor)) {
      return res.status(403).json({ success: false, error: 'Access denied: Middle Office Officer or Manager role required' });
    }
    req.actor = actor;
    next();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
}

module.exports = { requireMiddleOffice, requireMiddleOfficeApprover };
