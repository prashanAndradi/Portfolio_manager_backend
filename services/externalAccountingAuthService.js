/**
 * Manages the service-account token for the external accounting API
 * (Trial Balance / GSec Balance Sheet). This app's own user tokens are NOT
 * valid there - it's a separate service with its own auth, so this backend
 * logs in once with a dedicated service account and caches the token,
 * re-authenticating when it's missing, expired, or rejected.
 */
const EXTERNAL_ACCOUNTING_API_BASE_URL =
  process.env.EXTERNAL_ACCOUNTING_API_BASE_URL ||
  'https://vc1bp9jg70.execute-api.us-east-1.amazonaws.com/prod';

let cachedToken = null;
let cachedTokenExpiryMs = null;
let loginPromise = null;

function decodeJwtExpiryMs(token) {
  try {
    const payloadB64 = token.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
    return payload.exp ? payload.exp * 1000 : null;
  } catch (_) {
    return null;
  }
}

/**
 * Errors carry a `reason` so the proxy can tell the caller WHICH part of the
 * integration failed. Without it every failure collapses into one "couldn't
 * reach the service" message and the real cause - unset credentials, a
 * rejected login, no outbound network - can only be found in server logs,
 * which is no help when the failure is in a deployed environment.
 */
class ExternalAccountingError extends Error {
  constructor(reason, message, details) {
    super(message);
    this.name = 'ExternalAccountingError';
    this.reason = reason;
    this.details = details;
  }
}

function isConfigured() {
  return Boolean(
    process.env.EXTERNAL_ACCOUNTING_API_EMAIL && process.env.EXTERNAL_ACCOUNTING_API_PASSWORD
  );
}

async function login() {
  const email = process.env.EXTERNAL_ACCOUNTING_API_EMAIL;
  const password = process.env.EXTERNAL_ACCOUNTING_API_PASSWORD;
  if (!email || !password) {
    throw new ExternalAccountingError(
      'not_configured',
      'EXTERNAL_ACCOUNTING_API_EMAIL / EXTERNAL_ACCOUNTING_API_PASSWORD are not configured'
    );
  }

  let res;
  try {
    res = await fetch(`${EXTERNAL_ACCOUNTING_API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
  } catch (err) {
    // Thrown before any HTTP response: DNS, TLS, blocked egress, or a runtime
    // with no global fetch (Node < 18).
    throw new ExternalAccountingError(
      'unreachable',
      `Could not open a connection to ${EXTERNAL_ACCOUNTING_API_BASE_URL}: ${err.message}`,
      err.cause ? String(err.cause.message || err.cause) : undefined
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // The external API answers an invalid email/password with 400, not 401, so
    // any 4xx on the login endpoint is treated as a credentials problem.
    const rejected = res.status >= 400 && res.status < 500;
    throw new ExternalAccountingError(
      rejected ? 'bad_credentials' : 'login_failed',
      `External accounting login failed (${res.status})`,
      text ? String(text).slice(0, 300) : undefined
    );
  }

  const data = await res.json();
  if (!data.token) {
    throw new ExternalAccountingError(
      'login_failed',
      'External accounting login response did not include a token'
    );
  }

  cachedToken = data.token;
  cachedTokenExpiryMs = decodeJwtExpiryMs(data.token);
  return cachedToken;
}

/**
 * @param {boolean} [forceRefresh] - bypass the cache and log in again (e.g. after a 401).
 * @returns {Promise<string>} bearer token
 */
async function getServiceToken(forceRefresh = false) {
  const now = Date.now();
  const expiringSoon = cachedTokenExpiryMs && cachedTokenExpiryMs - now < 30000;

  if (forceRefresh || !cachedToken || expiringSoon) {
    // Coalesce concurrent callers into a single login request.
    if (!loginPromise) {
      loginPromise = login().finally(() => {
        loginPromise = null;
      });
    }
    return loginPromise;
  }

  return cachedToken;
}

module.exports = {
  getServiceToken,
  isConfigured,
  ExternalAccountingError,
  EXTERNAL_ACCOUNTING_API_BASE_URL
};
