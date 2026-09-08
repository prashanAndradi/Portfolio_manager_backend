'use strict';

// Shared 3-tier approval-stage role map, used by every product's status/approval
// endpoint (GSEC, T-Bill, Money Market, Buyback, Repo) so "who can act on a deal
// at its current stage" is defined once instead of copy-pasted per controller.
// Keys match the `current_approval_level` values used by GSEC/T-Bill/Money Market.
const STAGE_OWNER_ROLES = {
  front_office: ['front_office', 'front_office_verifier'],
  back_office_verifier: ['back_office_verifier'],
  back_office_final: ['back_office_final']
};

function requiredRolesForStage(stageKey) {
  return STAGE_OWNER_ROLES[stageKey] || STAGE_OWNER_ROLES.front_office;
}

function actorCanActAtStage(actor, stageKey) {
  if (!actor) return false;
  if (actor.isAdmin) return true;
  return requiredRolesForStage(stageKey).includes(actor.role);
}

// Middle office (middle_office_user / _officer / _manager) is a separate,
// independent assignment axis from the deal-workflow tiers above - a user can
// hold both at once. Check assignment membership directly rather than the
// single `effectiveRole` winner, so holding a deal-workflow role too never
// hides middle-office access (or vice versa).
function isMiddleOffice(actor) {
  if (!actor) return false;
  if (actor.isAdmin) return true;
  return Array.isArray(actor.assignments) && actor.assignments.some(
    (a) => typeof a.role === 'string' && a.role.startsWith('middle_office_')
  );
}

const MIDDLE_OFFICE_TIER_RANK = {
  middle_office_user: 1,
  middle_office_officer: 2,
  middle_office_manager: 3
};

// Highest middle-office tier this actor holds, or null if none. A user could
// in principle hold more than one middle-office assignment row; the highest
// wins for tier-gating purposes (mirrors ROLE_PRIORITY's approach on the
// deal-workflow side).
function getMiddleOfficeTier(actor) {
  if (!actor || !Array.isArray(actor.assignments)) return null;
  let best = null;
  for (const a of actor.assignments) {
    if (typeof a.role === 'string' && MIDDLE_OFFICE_TIER_RANK[a.role]) {
      if (!best || MIDDLE_OFFICE_TIER_RANK[a.role] > MIDDLE_OFFICE_TIER_RANK[best]) {
        best = a.role;
      }
    }
  }
  return best;
}

// Officer/manager can approve a dealer-limit change proposed by a
// middle_office_user; middle_office_user cannot approve its own proposals.
function isMiddleOfficeApprover(actor) {
  if (!actor) return false;
  if (actor.isAdmin) return true;
  const tier = getMiddleOfficeTier(actor);
  return tier === 'middle_office_officer' || tier === 'middle_office_manager';
}

module.exports = {
  STAGE_OWNER_ROLES,
  requiredRolesForStage,
  actorCanActAtStage,
  isMiddleOffice,
  MIDDLE_OFFICE_TIER_RANK,
  getMiddleOfficeTier,
  isMiddleOfficeApprover
};
