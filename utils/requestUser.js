/**
 * Resolve the acting user id from JWT, x-user-data header, or request body.
 * Never defaults to a hard-coded user — missing id returns null.
 */
function parseHeaderUser(req) {
  try {
    const raw = req.headers?.['x-user-data'];
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
}

/**
 * A usable user id, or null. Never substitutes a placeholder account -
 * an unattributable record must stay NULL rather than be pinned on a real user.
 */
function normalizeUserId(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveRequestUserId(req) {
  const body = req.body || {};
  const headerUser = parseHeaderUser(req);
  const candidates = [
    req.user?.id,
    req.user?.userId,
    req.user?.user_id,
    headerUser?.id,
    body.userId,
    body.user_id,
    body.created_by,
    body.createdBy
  ];
  for (const raw of candidates) {
    const n = normalizeUserId(raw);
    if (n !== null) return n;
  }
  return null;
}

function resolveRequestUsername(req) {
  return req.user?.username || req.body?.username || null;
}

module.exports = { resolveRequestUserId, resolveRequestUsername, normalizeUserId };
