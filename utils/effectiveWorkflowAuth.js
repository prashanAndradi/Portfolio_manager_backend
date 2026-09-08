'use strict';

const db = require('../config/database');

// Same order as login: a user with several assignments gets the highest workflow role.
// The middle_office_* tiers are listed last deliberately: middle office is an
// independent oversight axis, not a deal-workflow tier, so a user holding both
// a deal-workflow role and a middle-office assignment should still resolve to
// the deal-workflow role as their `effectiveRole` (nav/landing-page identity).
// Middle-office gating never relies on `effectiveRole` - see isMiddleOffice()
// in utils/workflowStageAuth.js, which checks assignment membership directly.
const ROLE_PRIORITY = [
  'back_office_final',
  'back_office_verifier',
  'back_office',
  'front_office',
  'front_office_verifier',
  'authorizer',
  'middle_office_manager',
  'middle_office_officer',
  'middle_office_user'
];

function parsePages(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'object') return Object.values(value).filter(Boolean).map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
      if (parsed) return [String(parsed)];
    } catch {
      return [value];
    }
  }
  return [];
}

/**
 * Workflow role and tabs from the database, not from JWT or x-user-data.
 * Returns null if the user id is missing or the user row does not exist.
 */
async function resolveEffectiveWorkflowAuth(userId) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const [users] = await db.query(
    'SELECT id, username, role, allowed_tabs FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  if (!users.length) return null;

  const user = users[0];
  const [assignments] = await db.query(
    'SELECT * FROM authorizer_assignments WHERE user_id = ?',
    [id]
  );

  let effectiveRole = user.role || 'user';
  let allowedTabs = parsePages(user.allowed_tabs);

  if (assignments && assignments.length > 0) {
    let best = assignments[0];
    for (const role of ROLE_PRIORITY) {
      const found = assignments.find((a) => a.role === role);
      if (found) {
        best = found;
        break;
      }
    }
    effectiveRole = best.role;
    // Merge allowed_pages from EVERY assignment, not just the highest-priority
    // ("best") one - a user can hold multiple independent assignments at once
    // (e.g. back_office_verifier for deal approval AND middle_office_officer
    // for oversight), and must see pages granted under either. Only
    // `effectiveRole` itself is winner-take-all (nav/landing identity).
    const allAssignmentPages = assignments.flatMap((a) => parsePages(a.allowed_pages));
    allowedTabs = Array.from(new Set([...allowedTabs, ...allAssignmentPages]));
  }

  return {
    id: user.id,
    username: user.username,
    role: effectiveRole,
    originalRole: user.role,
    allowedTabs,
    isAdmin: user.role === 'admin' || effectiveRole === 'admin',
    assignments
  };
}

module.exports = {
  ROLE_PRIORITY,
  parsePages,
  resolveEffectiveWorkflowAuth
};
