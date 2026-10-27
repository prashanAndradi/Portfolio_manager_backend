/**
 * Server-to-server proxy for the external Trial Balance / GSec Balance Sheet API.
 *
 * The external API's CORS policy only allows requests from its own AWS Amplify
 * origin, so the browser blocks direct calls from this app's frontend. Proxying
 * through this backend avoids CORS entirely (server-to-server has no CORS
 * concept). It also authenticates with a dedicated service account (see
 * services/externalAccountingAuthService.js) rather than this app's own user
 * tokens, since the external API is a separate auth domain.
 */
const express = require('express');
const router = express.Router();
const { checkAuth, checkAdmin } = require('../middleware/auth');
const {
  getServiceToken,
  isConfigured,
  ExternalAccountingError,
  EXTERNAL_ACCOUNTING_API_BASE_URL
} = require('../services/externalAccountingAuthService');

function buildUrl(externalPath, query) {
  const url = new URL(`${EXTERNAL_ACCOUNTING_API_BASE_URL}${externalPath}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return url;
}

/** GET the upstream URL, turning a connection-level failure into a classified error. */
async function get(url, token) {
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
    });
  } catch (err) {
    throw new ExternalAccountingError(
      'unreachable',
      `Could not open a connection to ${url.origin}: ${err.message}`,
      err.cause ? String(err.cause.message || err.cause) : undefined
    );
  }
}

async function fetchExternal(externalPath, query) {
  const url = buildUrl(externalPath, query);

  let token = await getServiceToken();
  let upstream = await get(url, token);

  // Cached token might have been rejected (expired/revoked server-side) - refresh once and retry.
  if (upstream.status === 401) {
    token = await getServiceToken(true);
    upstream = await get(url, token);
  }

  return upstream;
}

// What the caller is told for each failure, so the screen shows the actual
// problem instead of a single "try again later" that is never going to help.
const REASON_RESPONSE = {
  not_configured: {
    status: 503,
    message:
      'The external accounting service is not configured on this server ' +
      '(EXTERNAL_ACCOUNTING_API_EMAIL / EXTERNAL_ACCOUNTING_API_PASSWORD are missing).'
  },
  bad_credentials: {
    status: 502,
    message:
      'The external accounting service rejected this server\'s credentials. ' +
      'The service account password may have changed.'
  },
  login_failed: {
    status: 502,
    message: 'Could not sign in to the external accounting service.'
  },
  unreachable: {
    status: 504,
    message:
      'This server could not reach the external accounting service. ' +
      'It may be down, or outbound network access may be blocked from this environment.'
  }
};

async function proxyGet(externalPath, req, res) {
  try {
    const upstream = await fetchExternal(externalPath, req.query);
    const contentType = upstream.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await upstream.json()
      : await upstream.text();

    res.status(upstream.status);
    if (contentType.includes('application/json')) {
      return res.json(body);
    }
    return res.send(body);
  } catch (error) {
    const reason = error instanceof ExternalAccountingError ? error.reason : null;
    const mapped = REASON_RESPONSE[reason];
    console.error(
      `External accounting proxy error (${externalPath}) [${reason || 'unknown'}]:`,
      error.message,
      error.details || ''
    );
    return res.status(mapped ? mapped.status : 502).json({
      success: false,
      reason: reason || 'unknown',
      message: mapped
        ? mapped.message
        : 'Failed to reach the external accounting service. Please try again later.',
      // The underlying message, so the cause is visible without server log access.
      // It never contains the service-account password - only the email is ever
      // sent, and login failures echo at most 300 characters of the upstream body.
      detail: error.message
    });
  }
}

/**
 * GET /api/external-accounting/health
 *
 * Admin-only check of this integration in whichever environment it runs in:
 * are the credentials present, does the login succeed, does the API answer.
 * The password is never returned - only whether it is set.
 */
router.get('/health', checkAuth, checkAdmin, async (req, res) => {
  const result = {
    baseUrl: EXTERNAL_ACCOUNTING_API_BASE_URL,
    nodeVersion: process.version,
    hasGlobalFetch: typeof fetch === 'function',
    configured: isConfigured(),
    email: process.env.EXTERNAL_ACCOUNTING_API_EMAIL || null,
    passwordSet: Boolean(process.env.EXTERNAL_ACCOUNTING_API_PASSWORD),
    // Where this process reads configuration from, and which source supplied
    // each key. Names and paths only - no values. DB_HOST is included as a
    // control: it is known to be set, so whichever source provides it is the
    // source the two missing keys must be added to.
    env: require('../config/envLoad').describe([
      'EXTERNAL_ACCOUNTING_API_EMAIL',
      'EXTERNAL_ACCOUNTING_API_PASSWORD',
      'EXTERNAL_ACCOUNTING_API_BASE_URL',
      'DB_HOST',
      'JWT_SECRET'
    ]),
    login: null,
    trialBalance: null
  };

  if (!result.configured) {
    result.ok = false;
    result.reason = 'not_configured';
    return res.status(503).json(result);
  }

  const started = Date.now();
  try {
    await getServiceToken(true);
    result.login = { ok: true, ms: Date.now() - started };
  } catch (error) {
    result.login = {
      ok: false,
      ms: Date.now() - started,
      reason: error.reason || 'unknown',
      message: error.message,
      detail: error.details
    };
    result.ok = false;
    result.reason = error.reason || 'unknown';
    return res.status(REASON_RESPONSE[result.reason]?.status || 502).json(result);
  }

  const probeStarted = Date.now();
  try {
    const upstream = await fetchExternal('/trial-balance', { endDate: req.query.endDate });
    const text = await upstream.text();
    result.trialBalance = {
      ok: upstream.ok,
      status: upstream.status,
      ms: Date.now() - probeStarted,
      bytes: text.length
    };
    result.ok = upstream.ok;
    if (!upstream.ok) result.trialBalance.body = text.slice(0, 300);
  } catch (error) {
    result.trialBalance = {
      ok: false,
      ms: Date.now() - probeStarted,
      reason: error.reason || 'unknown',
      message: error.message
    };
    result.ok = false;
    result.reason = error.reason || 'unknown';
  }

  return res.status(result.ok ? 200 : 502).json(result);
});

// GET /api/external-accounting/trial-balance?startDate=&endDate=&_ts=
router.get('/trial-balance', checkAuth, (req, res) => proxyGet('/trial-balance', req, res));

// GET /api/external-accounting/trial-balance/account/:accountCode?startDate=&endDate=
router.get('/trial-balance/account/:accountCode', checkAuth, (req, res) =>
  proxyGet(`/trial-balance/account/${encodeURIComponent(req.params.accountCode)}`, req, res)
);

// GET /api/external-accounting/gsec-entries/balance-sheet?startDate=&endDate=
router.get('/gsec-entries/balance-sheet', checkAuth, (req, res) =>
  proxyGet('/gsec-entries/balance-sheet', req, res)
);

// GET /api/external-accounting/gsec-entries/balance-sheet/account/:accountCode?startDate=&endDate=
router.get('/gsec-entries/balance-sheet/account/:accountCode', checkAuth, (req, res) =>
  proxyGet(`/gsec-entries/balance-sheet/account/${encodeURIComponent(req.params.accountCode)}`, req, res)
);

module.exports = router;
