/**
 * Full OpenAPI path catalog for every mounted backend route.
 * Merged into swagger-jsdoc output in server.js so /api-docs lists the complete API.
 *
 * Paths include the /api prefix because the Swagger server URL is http://localhost:3001
 * (also covers the legacy /isin-master mount without /api).
 */

const json = (description = 'OK') => ({
  200: {
    description,
    content: { 'application/json': { schema: { type: 'object' } } }
  },
  400: { description: 'Bad request' },
  401: { description: 'Unauthorized' },
  403: { description: 'Forbidden' },
  404: { description: 'Not found' },
  500: { description: 'Server error' }
});

const q = (name, description, extra = {}) => ({
  in: 'query',
  name,
  required: false,
  schema: { type: extra.type || 'string' },
  description
});

const p = (name, description, extra = {}) => ({
  in: 'path',
  name,
  required: true,
  schema: { type: extra.type || 'string' },
  description
});

const body = (properties = {}, required = []) => ({
  required: true,
  content: {
    'application/json': {
      schema: { type: 'object', properties, required }
    }
  }
});

const op = ({ summary, tags, parameters, requestBody, security, responses }) => {
  const item = {
    summary,
    tags: Array.isArray(tags) ? tags : [tags],
    responses: responses || json(summary)
  };
  if (security === false) item.security = [];
  if (parameters) item.parameters = parameters;
  if (requestBody) item.requestBody = requestBody;
  return item;
};

const crud = (tag, resource, idName = 'id') => ({
  get: op({ summary: `List ${resource}`, tags: tag }),
  post: op({ summary: `Create ${resource}`, tags: tag, requestBody: body() })
});

const crudById = (tag, resource, idName = 'id') => ({
  get: op({ summary: `Get ${resource} by ${idName}`, tags: tag, parameters: [p(idName, `${resource} ${idName}`)] }),
  put: op({
    summary: `Update ${resource}`,
    tags: tag,
    parameters: [p(idName, `${resource} ${idName}`)],
    requestBody: body()
  }),
  delete: op({
    summary: `Delete ${resource}`,
    tags: tag,
    parameters: [p(idName, `${resource} ${idName}`)]
  })
});

const reportQuery = [
  q('asAtDate', 'As-at date (YYYY-MM-DD)'),
  q('portfolio', 'Portfolio filter'),
  q('isin', 'ISIN filter'),
  q('valueDate', 'Value date filter'),
  q('maturityDate', 'Maturity date filter'),
  q('format', 'Export format: json, csv, excel, pdf'),
  q('page', 'Page number', { type: 'integer' }),
  q('pageSize', 'Page size', { type: 'integer' })
];

const tags = [
  { name: 'Auth', description: 'Login, registration, and password' },
  { name: 'Users', description: 'User administration' },
  { name: 'Authorizers', description: 'Workflow role assignments' },
  { name: 'System Day', description: 'Treasury system date' },
  { name: 'GSEC', description: 'Government securities deals and settlement letters' },
  { name: 'ISIN Master', description: 'ISIN master and GSEC deal capture' },
  { name: 'T-Bill', description: 'Treasury bill deals' },
  { name: 'Buyback', description: 'Buyback deals' },
  { name: 'Repo Deals', description: 'Repo and reverse-repo deals' },
  { name: 'Money Market', description: 'Money-market deals, EOD, and vouchers' },
  { name: 'Fixed Deposit', description: 'Fixed-deposit investment requests' },
  { name: 'Maturity', description: 'Maturity handling, premature maturity, and pre-approval' },
  { name: 'Reports', description: 'Portfolio, GSEC, buyback, repo, T-bill, and related reports' },
  { name: 'Accounting', description: 'Chart of accounts, ledger, P&L, trial balance' },
  { name: 'Account Mappings', description: 'Ledger account mapping keys' },
  { name: 'Chart of Accounts', description: 'COA import and export' },
  { name: 'Cashflow', description: 'Cashflow statement and transactions' },
  { name: 'Mark to Market', description: 'MTM upload and enquiry' },
  { name: 'Counterparties', description: 'Corporate, individual, and joint counterparties' },
  { name: 'Masters', description: 'Portfolio, strategy, payment, settlement, holiday, fund centre, issuer, broker' },
  { name: 'Limits', description: 'Counterparty product limits' },
  { name: 'Documents', description: 'Transaction document upload and download' },
  { name: 'Deal Confirmation', description: 'PDF/Word deal confirmations' },
  { name: 'Blotters', description: 'Daily deal and coupon maturity blotters' },
  { name: 'External Accounting', description: 'Proxy to the external accounting API' },
  { name: 'Transactions', description: 'Generic transactions, types, securities, accounts' }
];

const paths = {
  '/': {
    get: op({ summary: 'API welcome', tags: 'Auth', security: false })
  },
  '/api/test': {
    get: op({ summary: 'Health/test ping', tags: 'Auth', security: false })
  },
  '/api/test-login': {
    post: op({
      summary: 'Test login (always succeeds)',
      tags: 'Auth',
      security: false,
      requestBody: body({ username: { type: 'string' }, password: { type: 'string' } })
    })
  },

  '/api/auth/login': {
    post: op({
      summary: 'User login',
      tags: 'Auth',
      security: false,
      requestBody: body(
        { username: { type: 'string' }, password: { type: 'string' } },
        ['username', 'password']
      )
    })
  },
  '/api/auth/register': {
    post: op({
      summary: 'Register a user',
      tags: 'Auth',
      security: false,
      requestBody: body({ username: { type: 'string' }, password: { type: 'string' }, role: { type: 'string' } })
    })
  },
  '/api/auth/forgot-password': {
    post: op({
      summary: 'Request password reset',
      tags: 'Auth',
      security: false,
      requestBody: body({ username: { type: 'string' } }, ['username'])
    })
  },
  '/api/auth/reset-password': {
    post: op({
      summary: 'Reset password with token',
      tags: 'Auth',
      security: false,
      requestBody: body({ token: { type: 'string' }, password: { type: 'string' } }, ['token', 'password'])
    })
  },
  '/api/auth/change-password': {
    post: op({
      summary: 'Change password (authenticated)',
      tags: 'Auth',
      requestBody: body({ currentPassword: { type: 'string' }, newPassword: { type: 'string' } })
    })
  },

  '/api/users': {
    get: op({ summary: 'List users (legacy /api/users)', tags: 'Users' })
  },
  '/api/user': {
    get: op({ summary: 'List users', tags: 'Users' })
  },
  '/api/user/{id}/tabs': {
    put: op({
      summary: 'Update allowed tabs for a user',
      tags: 'Users',
      parameters: [p('id', 'User ID')],
      requestBody: body({ allowed_tabs: { type: 'array', items: { type: 'string' } } })
    })
  },
  '/api/user/{userId}/admin-reset-password': {
    post: op({
      summary: 'Admin reset of a user password',
      tags: 'Users',
      parameters: [p('userId', 'User ID')],
      requestBody: body({ newPassword: { type: 'string' } })
    })
  },

  '/api/authorizers': {
    get: op({ summary: 'List authorizer assignments', tags: 'Authorizers' }),
    post: op({ summary: 'Create authorizer assignment', tags: 'Authorizers', requestBody: body() })
  },
  '/api/authorizers/users': {
    get: op({ summary: 'List users available for assignment', tags: 'Authorizers' })
  },

  '/api/system-day': {
    get: op({ summary: 'Get current system date', tags: 'System Day', security: false }),
    post: op({
      summary: 'Set system date (admin)',
      tags: 'System Day',
      requestBody: body({ system_date: { type: 'string', example: '2026-08-17' } }, ['system_date'])
    })
  },

  '/api/gsec': {
    get: op({
      summary: 'List GSEC transactions',
      tags: 'GSEC',
      parameters: [q('portfolio', 'Portfolio filter'), q('approval_level', 'Approval level', { type: 'integer' })]
    })
  },
  '/api/gsec/{id}/approve': {
    post: op({ summary: 'Approve a GSEC transaction', tags: 'GSEC', parameters: [p('id', 'GSEC deal ID')] })
  },
  '/api/gsec/buy-deals': {
    get: op({ summary: 'List GSEC buy deals', tags: 'GSEC' })
  },
  '/api/gsec/buy-deals-with-balance': {
    get: op({ summary: 'List GSEC buy deals with remaining face', tags: 'GSEC' })
  },
  '/api/gsec/{id}/letter': {
    get: op({ summary: 'GSEC settlement letter data (JSON)', tags: 'GSEC', parameters: [p('id', 'GSEC deal ID')] })
  },
  '/api/gsec/{id}/letter/html': {
    get: op({
      summary: 'GSEC settlement letter HTML',
      tags: 'GSEC',
      parameters: [p('id', 'GSEC deal ID')],
      responses: { 200: { description: 'HTML document' }, 403: { description: 'Forbidden' }, 404: { description: 'Not found' } }
    })
  },

  '/api/isin-master': {
    get: op({ summary: 'List ISINs', tags: 'ISIN Master' }),
    post: op({ summary: 'Create ISIN', tags: 'ISIN Master', requestBody: body() })
  },
  '/api/isin-master/search': {
    get: op({ summary: 'Search ISINs', tags: 'ISIN Master', parameters: [q('q', 'Search text')] })
  },
  '/api/isin-master/{id}': {
    get: op({ summary: 'Get ISIN by ID', tags: 'ISIN Master', parameters: [p('id', 'ISIN master ID')] }),
    put: op({ summary: 'Update ISIN', tags: 'ISIN Master', parameters: [p('id', 'ISIN master ID')], requestBody: body() })
  },
  '/api/isin-master/{isin}/coupon-dates': {
    get: op({ summary: 'Previous/next coupon dates for an ISIN', tags: 'ISIN Master', parameters: [p('isin', 'ISIN number')] })
  },
  '/api/isin-master/{isin}/coupon-months': {
    get: op({ summary: 'Coupon months for an ISIN', tags: 'ISIN Master', parameters: [p('isin', 'ISIN number')] })
  },
  '/api/isin-master/gsec': {
    post: op({ summary: 'Save a GSEC deal', tags: 'ISIN Master', requestBody: body() })
  },
  '/api/isin-master/gsec-buyback': {
    post: op({ summary: 'Save a GSEC buyback-linked deal', tags: 'ISIN Master', requestBody: body() })
  },
  '/api/isin-master/gsec/buy-deals': {
    get: op({ summary: 'GSEC buy deals with available balance', tags: 'ISIN Master' })
  },
  '/api/isin-master/gsec/source-buy-deals': {
    get: op({ summary: 'Source buy deals for GSEC sells', tags: 'ISIN Master' })
  },
  '/api/isin-master/gsec/sell-history': {
    get: op({ summary: 'GSEC sell history', tags: 'ISIN Master' })
  },
  '/api/isin-master/gsec/recent': {
    get: op({ summary: 'Recent GSEC transactions (blotter feed)', tags: 'ISIN Master' })
  },
  '/api/isin-master/gsec-latest-deal-number': {
    get: op({ summary: 'Latest GSEC deal number', tags: 'ISIN Master' })
  },
  '/api/isin-master/gsec/{id}': {
    put: op({ summary: 'Update a GSEC transaction', tags: 'ISIN Master', parameters: [p('id', 'GSEC ID')], requestBody: body() })
  },
  '/api/isin-master/gsec/{id}/status': {
    put: op({
      summary: 'Update GSEC approval status',
      tags: 'ISIN Master',
      parameters: [p('id', 'GSEC ID')],
      requestBody: body({ status: { type: 'string' }, userId: { type: 'integer' } })
    })
  },
  '/api/isin-master/gsec/backfill-ledger-entries': {
    post: op({ summary: 'Backfill GSEC ledger entries', tags: 'ISIN Master' })
  },
  '/isin-master': {
    get: op({ summary: 'List ISINs (legacy mount without /api)', tags: 'ISIN Master' }),
    post: op({ summary: 'Create ISIN (legacy mount without /api)', tags: 'ISIN Master', requestBody: body() })
  },

  '/api/tbill': {
    post: op({ summary: 'Create T-Bill deal', tags: 'T-Bill', requestBody: body() })
  },
  '/api/tbill/recent': {
    get: op({ summary: 'Recent T-Bill deals', tags: 'T-Bill' })
  },
  '/api/tbill/buy-deals': {
    get: op({ summary: 'T-Bill buy deals with remaining face', tags: 'T-Bill' })
  },
  '/api/tbill/{id}': {
    put: op({ summary: 'Update T-Bill deal', tags: 'T-Bill', parameters: [p('id', 'T-Bill ID')], requestBody: body() })
  },
  '/api/tbill/{id}/status': {
    put: op({
      summary: 'Update T-Bill status',
      tags: 'T-Bill',
      parameters: [p('id', 'T-Bill ID')],
      requestBody: body({ status: { type: 'string' } })
    })
  },

  '/api/buyback': {
    get: op({ summary: 'List buyback deals', tags: 'Buyback' }),
    post: op({ summary: 'Create buyback deal', tags: 'Buyback', requestBody: body() })
  },
  '/api/buyback/status/{status}': {
    get: op({
      summary: 'List buyback deals by status',
      tags: 'Buyback',
      parameters: [p('status', 'Deal status, e.g. Approved, Verified, Pending_Final_Approval')]
    })
  },
  '/api/buyback/{id}': {
    get: op({ summary: 'Get buyback deal', tags: 'Buyback', parameters: [p('id', 'Buyback ID')] }),
    put: op({ summary: 'Update buyback deal', tags: 'Buyback', parameters: [p('id', 'Buyback ID')], requestBody: body() }),
    delete: op({ summary: 'Delete buyback deal', tags: 'Buyback', parameters: [p('id', 'Buyback ID')] })
  },
  '/api/buyback/{id}/status': {
    patch: op({
      summary: 'Update buyback verification/approval status',
      tags: 'Buyback',
      parameters: [p('id', 'Buyback ID')],
      requestBody: body({ status: { type: 'string' }, action: { type: 'string' }, comment: { type: 'string' } })
    })
  },

  '/api/repo-deals': {
    get: op({ summary: 'List repo deals', tags: 'Repo Deals' }),
    post: op({ summary: 'Create repo deal', tags: 'Repo Deals', requestBody: body() })
  },
  '/api/repo-deals/backfill-ledger': {
    post: op({ summary: 'Backfill repo ledger entries', tags: 'Repo Deals' })
  },
  '/api/repo-deals/{id}': {
    get: op({ summary: 'Get repo deal', tags: 'Repo Deals', parameters: [p('id', 'Repo deal ID')] }),
    put: op({ summary: 'Update repo deal', tags: 'Repo Deals', parameters: [p('id', 'Repo deal ID')], requestBody: body() }),
    delete: op({ summary: 'Delete repo deal', tags: 'Repo Deals', parameters: [p('id', 'Repo deal ID')] })
  },
  '/api/repo-deals/{id}/status': {
    patch: op({
      summary: 'Update repo deal status',
      tags: 'Repo Deals',
      parameters: [p('id', 'Repo deal ID')],
      requestBody: body({ status: { type: 'string' } })
    })
  },
  '/api/repo-deals/{id}/approval': {
    patch: op({
      summary: 'Update repo approval status',
      tags: 'Repo Deals',
      parameters: [p('id', 'Repo deal ID')],
      requestBody: body()
    })
  },
  '/api/repo-deals/counterparty/{counterpartyId}': {
    get: op({ summary: 'Repo deals by counterparty', tags: 'Repo Deals', parameters: [p('counterpartyId', 'Counterparty ID')] })
  },
  '/api/repo-deals/isin/{isinNumber}': {
    get: op({ summary: 'Repo deals by ISIN', tags: 'Repo Deals', parameters: [p('isinNumber', 'ISIN')] })
  },
  '/api/repo-deals/status/active': {
    get: op({ summary: 'Active repo deals', tags: 'Repo Deals' })
  },
  '/api/repo-deals/expiring/soon': {
    get: op({ summary: 'Repo deals expiring soon', tags: 'Repo Deals' })
  },
  '/api/repo-deals/summary/stats': {
    get: op({ summary: 'Repo deal summary statistics', tags: 'Repo Deals' })
  },

  '/api/money-market-deals': {
    get: op({ summary: 'List money-market deals', tags: 'Money Market' }),
    post: op({ summary: 'Create money-market deal', tags: 'Money Market', requestBody: body() })
  },
  '/api/money-market-deals/{deal_number}': {
    put: op({
      summary: 'Update money-market deal',
      tags: 'Money Market',
      parameters: [p('deal_number', 'Deal number')],
      requestBody: body()
    })
  },
  '/api/money-market/eod': {
    post: op({ summary: 'Run end-of-day processing', tags: 'Money Market' })
  },
  '/api/money-market/ledger-post': {
    post: op({ summary: 'Post money-market ledger (admin)', tags: 'Money Market' })
  },
  '/api/money-market/daily-interest': {
    get: op({ summary: 'Daily interest for money-market deals', tags: 'Money Market' })
  },
  '/api/money-market/{deal_number}/voucher': {
    get: op({
      summary: 'Download money-market voucher PDF',
      tags: 'Money Market',
      parameters: [p('deal_number', 'Deal number')],
      responses: { 200: { description: 'PDF' }, 404: { description: 'Deal not found' } }
    })
  },

  '/api/fixed-deposit/fund-movement-sources': {
    get: op({ summary: 'Fund-movement source accounts', tags: 'Fixed Deposit' })
  },
  '/api/fixed-deposit/requests': {
    get: op({ summary: 'List FD requests', tags: 'Fixed Deposit' }),
    post: op({ summary: 'Create FD request', tags: 'Fixed Deposit', requestBody: body() })
  },
  '/api/fixed-deposit/requests/pending': {
    get: op({ summary: 'Pending FD requests', tags: 'Fixed Deposit' })
  },
  '/api/fixed-deposit/requests/{id}': {
    get: op({ summary: 'Get FD request', tags: 'Fixed Deposit', parameters: [p('id', 'Request ID')] }),
    put: op({
      summary: 'Update FD request',
      tags: 'Fixed Deposit',
      parameters: [p('id', 'Request ID')],
      requestBody: body()
    })
  },
  '/api/fixed-deposit/requests/{id}/approve': {
    put: op({ summary: 'Approve FD request', tags: 'Fixed Deposit', parameters: [p('id', 'Request ID')] })
  },
  '/api/fixed-deposit/requests/{id}/reject': {
    put: op({
      summary: 'Reject FD request',
      tags: 'Fixed Deposit',
      parameters: [p('id', 'Request ID')],
      requestBody: body({ comment: { type: 'string' } })
    })
  },
  '/api/fixed-deposit/requests/file-number/{fileNumber}': {
    get: op({ summary: 'FD request by file number', tags: 'Fixed Deposit', parameters: [p('fileNumber', 'File number')] })
  },
  '/api/fixed-deposit/requests/search/file-number': {
    get: op({ summary: 'Search FD requests by file number', tags: 'Fixed Deposit', parameters: [q('q', 'File number')] })
  },

  '/api/maturity/money-market': {
    get: op({ summary: 'Money-market maturities', tags: 'Maturity' })
  },
  '/api/maturity/fixed-income-gsec': {
    get: op({ summary: 'GSEC maturities', tags: 'Maturity' })
  },
  '/api/maturity/summary': {
    get: op({ summary: 'Maturity summary', tags: 'Maturity' })
  },
  '/api/maturity/handling': {
    get: op({
      summary: 'Daily maturity cashflow / handling',
      tags: 'Maturity',
      parameters: [q('date', 'Selected date YYYY-MM-DD'), q('productType', 'Product filter')]
    })
  },
  '/api/maturity/deal-ticket/{productType}/{id}': {
    get: op({
      summary: 'Maturity deal ticket',
      tags: 'Maturity',
      parameters: [p('productType', 'Product type'), p('id', 'Deal ID')]
    })
  },
  '/api/maturity/matured-slip-number': {
    get: op({ summary: 'Next matured slip number', tags: 'Maturity' })
  },
  '/api/maturity/process': {
    post: op({ summary: 'Process selected maturities', tags: 'Maturity', requestBody: body() })
  },
  '/api/maturity/export': {
    get: op({ summary: 'Export maturities', tags: 'Maturity', parameters: [q('format', 'csv, excel, pdf')] })
  },
  '/api/maturity/bank-accounts': {
    get: op({ summary: 'Bank accounts for maturity settlement', tags: 'Maturity' })
  },
  '/api/maturity/processing-history': {
    get: op({ summary: 'Maturity processing history', tags: 'Maturity' })
  },
  '/api/maturity/blotter': {
    get: op({ summary: 'Maturity blotter', tags: 'Maturity' })
  },
  '/api/maturity/reinvestment-details': {
    get: op({ summary: 'Deal details for reinvestment', tags: 'Maturity' })
  },
  '/api/maturity/amounts': {
    get: op({ summary: 'Maturity amounts', tags: 'Maturity' })
  },
  '/api/maturity/approve': {
    post: op({ summary: 'Approve maturities', tags: 'Maturity', requestBody: body() })
  },
  '/api/maturity/premature': {
    get: op({
      summary: 'Deals available for premature maturity',
      tags: 'Maturity',
      parameters: [q('productType', 'gsec, repo, buyback, money_market, all')]
    }),
    post: op({
      summary: 'Process premature maturity (non-buyback)',
      tags: 'Maturity',
      requestBody: body({
        dealIds: { type: 'array', items: { type: 'integer' } },
        prematureMaturityDate: { type: 'string' },
        productType: { type: 'string' }
      })
    })
  },
  '/api/maturity/premature/buyback': {
    post: op({
      summary: 'Process buyback premature maturity',
      tags: 'Maturity',
      requestBody: body({
        deals: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              dealId: { type: 'integer' },
              leg1InterestRate: { type: 'number' },
              leg2ValueDate: { type: 'string' },
              dayCountBasis: { type: 'integer', description: '364 or 365; defaults to ISIN day_basis / 364' }
            }
          }
        }
      })
    })
  },
  '/api/maturity/pre-approval/deals': {
    get: op({ summary: 'Deals pending maturity pre-approval', tags: 'Maturity' })
  },
  '/api/maturity/pre-approval/{productType}/{dealId}': {
    post: op({
      summary: 'Submit maturity pre-approval',
      tags: 'Maturity',
      parameters: [p('productType', 'Product type'), p('dealId', 'Deal ID')],
      requestBody: body()
    })
  },
  '/api/maturity/pre-approval/{productType}/{dealId}/approve': {
    put: op({
      summary: 'Approve maturity pre-approval',
      tags: 'Maturity',
      parameters: [p('productType', 'Product type'), p('dealId', 'Deal ID')]
    })
  },
  '/api/maturity/pre-approval/{productType}/{dealId}/reject': {
    put: op({
      summary: 'Reject maturity pre-approval',
      tags: 'Maturity',
      parameters: [p('productType', 'Product type'), p('dealId', 'Deal ID')],
      requestBody: body({ comment: { type: 'string' } })
    })
  },
  '/api/maturity/pre-approval/blotter': {
    get: op({ summary: 'Pre-approved maturity blotter', tags: 'Maturity' })
  },

  '/api/reports/gsec': {
    get: op({ summary: 'GSEC holdings report', tags: 'Reports', parameters: reportQuery })
  },
  '/api/reports/portfolio': {
    get: op({ summary: 'Portfolio report', tags: 'Reports', parameters: reportQuery })
  },
  '/api/reports/counterparty': {
    get: op({ summary: 'Counterparty report', tags: 'Reports', parameters: reportQuery })
  },
  '/api/reports/counterparty-master': {
    get: op({ summary: 'Counterparty master report', tags: 'Reports' })
  },
  '/api/reports/buyback': {
    get: op({ summary: 'Buyback report', tags: 'Reports', parameters: reportQuery })
  },
  '/api/reports/repo': {
    get: op({ summary: 'Repo / reverse-repo report', tags: 'Reports', parameters: reportQuery })
  },
  '/api/reports/tbill': {
    get: op({ summary: 'T-Bill report', tags: 'Reports', parameters: reportQuery })
  },
  '/api/reports/broker': {
    get: op({ summary: 'Broker report', tags: 'Reports', parameters: reportQuery })
  },
  '/api/reports/account-figures': {
    get: op({ summary: 'Account figures for GSEC trial-balance recon', tags: 'Reports' })
  },
  '/api/reports/money-market': {
    get: op({ summary: 'Money-market report (legacy)', tags: 'Reports', parameters: reportQuery })
  },
  '/api/reports/mark-to-market': {
    get: op({ summary: 'Mark-to-market report (legacy)', tags: 'Reports', parameters: reportQuery })
  },
  '/api/reports/sell-transaction': {
    get: op({ summary: 'Sell transaction report (legacy)', tags: 'Reports', parameters: reportQuery })
  },

  '/api/accounting/account-types': {
    get: op({ summary: 'Account types', tags: 'Accounting' })
  },
  '/api/accounting/chart-of-accounts': {
    get: op({ summary: 'Chart of accounts', tags: 'Accounting' }),
    post: op({ summary: 'Create chart-of-accounts row', tags: 'Accounting', requestBody: body() })
  },
  '/api/accounting/chart-of-accounts/{id}': {
    put: op({
      summary: 'Update chart-of-accounts row',
      tags: 'Accounting',
      parameters: [p('id', 'Account ID')],
      requestBody: body()
    })
  },
  '/api/accounting/general-ledger': {
    get: op({
      summary: 'General ledger',
      tags: 'Accounting',
      parameters: [
        q('limit', 'Page size', { type: 'integer' }),
        q('offset', 'Offset', { type: 'integer' }),
        q('account_id', 'Account ID'),
        q('from', 'From date'),
        q('to', 'To date')
      ]
    })
  },
  '/api/accounting/ledger-entries': {
    post: op({ summary: 'Post ledger entries', tags: 'Accounting', requestBody: body() })
  },
  '/api/accounting/profit-loss': {
    get: op({ summary: 'Profit and loss', tags: 'Accounting', parameters: [q('asAtDate', 'As-at date')] })
  },
  '/api/accounting/balance-sheet': {
    get: op({ summary: 'Balance sheet', tags: 'Accounting', parameters: [q('asAtDate', 'As-at date')] })
  },
  '/api/accounting/trial-balance': {
    get: op({ summary: 'Trial balance', tags: 'Accounting', parameters: [q('asAtDate', 'As-at date')] })
  },
  '/api/accounting/settlement-preview': {
    get: op({ summary: 'Settlement ledger preview', tags: 'Accounting', parameters: [q('date', 'Date')] })
  },

  '/api/account-mappings': {
    get: op({ summary: 'List account mappings', tags: 'Account Mappings' }),
    post: op({ summary: 'Create account mapping', tags: 'Account Mappings', requestBody: body() })
  },
  '/api/account-mappings/{mappingKey}': {
    get: op({
      summary: 'Get mapping by key',
      tags: 'Account Mappings',
      parameters: [p('mappingKey', 'Mapping key')]
    })
  },
  '/api/account-mappings/bulk': {
    post: op({ summary: 'Bulk upsert account mappings', tags: 'Account Mappings', requestBody: body() })
  },
  '/api/account-mappings/keys/all': {
    get: op({ summary: 'All mapping keys', tags: 'Account Mappings' })
  },
  '/api/chart-of-accounts/import': {
    post: op({
      summary: 'Import chart of accounts (Excel)',
      tags: 'Chart of Accounts',
      requestBody: {
        required: true,
        content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } }
      }
    })
  },
  '/api/chart-of-accounts/export': {
    get: op({ summary: 'Export chart of accounts', tags: 'Chart of Accounts' })
  },

  '/api/cashflow/statement': {
    get: op({
      summary: 'Cashflow statement',
      tags: 'Cashflow',
      parameters: [q('startDate', 'Start date'), q('endDate', 'End date')]
    })
  },
  '/api/cashflow/projections': {
    get: op({ summary: 'Cashflow projections', tags: 'Cashflow' })
  },
  '/api/cashflow/transactions': {
    get: op({ summary: 'Cashflow transactions', tags: 'Cashflow' }),
    post: op({ summary: 'Create cashflow transaction', tags: 'Cashflow', requestBody: body() })
  },
  '/api/cashflow/auto-categorize': {
    post: op({ summary: 'Auto-categorize cashflow transactions', tags: 'Cashflow' })
  },
  '/api/cashflow/categories': {
    get: op({ summary: 'Cashflow categories', tags: 'Cashflow' })
  },
  '/api/cashflow/reconcile': {
    post: op({ summary: 'Reconcile cashflow', tags: 'Cashflow', requestBody: body() })
  },

  '/api/mark-to-market': {
    get: op({ summary: 'List mark-to-market rows', tags: 'Mark to Market' })
  },
  '/api/mark-to-market/data': {
    get: op({ summary: 'List mark-to-market rows (alias)', tags: 'Mark to Market' })
  },
  '/api/mark-to-market/upload': {
    post: op({
      summary: 'Upload MTM Excel',
      tags: 'Mark to Market',
      requestBody: {
        required: true,
        content: { 'multipart/form-data': { schema: { type: 'object', properties: { excelFile: { type: 'string', format: 'binary' } } } } }
      }
    })
  },
  '/api/mark-to-market/series/{series}': {
    get: op({ summary: 'MTM by series', tags: 'Mark to Market', parameters: [p('series', 'Series name')] })
  },
  '/api/mark-to-market/statistics': {
    get: op({ summary: 'MTM summary statistics', tags: 'Mark to Market' })
  },
  '/api/mark-to-market/health': {
    get: op({ summary: 'MTM health check', tags: 'Mark to Market', security: false })
  },
  '/api/mark-to-market/record/{id}': {
    delete: op({ summary: 'Delete MTM record', tags: 'Mark to Market', parameters: [p('id', 'Record ID')] })
  },

  '/api/counterparties': {
    get: op({ summary: 'List counterparties (combined)', tags: 'Counterparties' })
  },
  '/api/counterparties/{id}': {
    get: op({ summary: 'Get counterparty', tags: 'Counterparties', parameters: [p('id', 'Counterparty ID')] })
  },
  '/api/counterparty-corporate': crud('Counterparties', 'corporate counterparty'),
  '/api/counterparty-corporate/{id}': {
    get: crudById('Counterparties', 'corporate counterparty').get,
    put: crudById('Counterparties', 'corporate counterparty').put
  },
  '/api/counterparty-individual': crud('Counterparties', 'individual counterparty'),
  '/api/counterparty-individual/{id}': {
    get: crudById('Counterparties', 'individual counterparty').get,
    put: crudById('Counterparties', 'individual counterparty').put
  },
  '/api/counterparty-joint': crud('Counterparties', 'joint counterparty'),
  '/api/counterparty-joint/{id}': {
    get: crudById('Counterparties', 'joint counterparty').get,
    put: crudById('Counterparties', 'joint counterparty').put
  },

  '/api/portfolio-master': crud('Masters', 'portfolio master'),
  '/api/portfolio-master/{id}': crudById('Masters', 'portfolio master'),
  '/api/strategy-master': crud('Masters', 'strategy'),
  '/api/strategy-master/{id}': crudById('Masters', 'strategy'),
  '/api/payment-master': {
    get: op({ summary: 'List payment masters', tags: 'Masters' }),
    post: op({ summary: 'Create payment master', tags: 'Masters', requestBody: body() })
  },
  '/api/payment-master/test': {
    get: op({ summary: 'Payment master test ping', tags: 'Masters', security: false })
  },
  '/api/payment-master/bank-payment-codes': {
    get: op({ summary: 'Bank payment codes', tags: 'Masters' })
  },
  '/api/payment-master/bank-details/{code}': {
    get: op({ summary: 'Bank details by payment code', tags: 'Masters', parameters: [p('code', 'Bank payment code')] })
  },
  '/api/payment-master/search': {
    get: op({ summary: 'Search payment masters', tags: 'Masters', parameters: [q('q', 'Search text')] })
  },
  '/api/payment-master/{id}': {
    put: op({ summary: 'Update payment master', tags: 'Masters', parameters: [p('id', 'ID')], requestBody: body() })
  },
  '/api/payment-master/methods': {
    get: op({ summary: 'Payment methods', tags: 'Masters' })
  },
  '/api/payment-master/all-methods': {
    get: op({ summary: 'All payment methods', tags: 'Masters' })
  },
  '/api/settlement-accounts': {
    get: op({ summary: 'List settlement accounts', tags: 'Masters' }),
    post: op({ summary: 'Create settlement account', tags: 'Masters', requestBody: body() })
  },
  '/api/settlement-accounts/{id}': {
    put: op({
      summary: 'Update settlement account',
      tags: 'Masters',
      parameters: [p('id', 'Settlement account ID')],
      requestBody: body()
    })
  },
  '/api/holiday-calendar': crud('Masters', 'holiday'),
  '/api/holiday-calendar/range': {
    get: op({
      summary: 'Holidays in date range',
      tags: 'Masters',
      parameters: [q('from', 'From date'), q('to', 'To date')]
    })
  },
  '/api/holiday-calendar/check/{date}': {
    get: op({ summary: 'Check if date is a holiday', tags: 'Masters', parameters: [p('date', 'YYYY-MM-DD')] })
  },
  '/api/holiday-calendar/check-currency/{date}': {
    get: op({
      summary: 'Check holiday for a currency',
      tags: 'Masters',
      parameters: [p('date', 'YYYY-MM-DD'), q('currency', 'Currency code')]
    })
  },
  '/api/holiday-calendar/{id}': crudById('Masters', 'holiday'),
  '/api/fund-centre-master': crud('Masters', 'fund centre'),
  '/api/fund-centre-master/dropdown/list': {
    get: op({ summary: 'Fund centres for dropdown', tags: 'Masters' })
  },
  '/api/fund-centre-master/{id}': crudById('Masters', 'fund centre'),
  '/api/issuer-master': crud('Masters', 'issuer'),
  '/api/issuer-master/{id}': crudById('Masters', 'issuer'),
  '/api/investment-approver-master': crud('Masters', 'investment approver'),
  '/api/investment-approver-master/{id}': crudById('Masters', 'investment approver'),
  '/api/brokers': crud('Masters', 'broker'),
  '/api/brokers/{id}': crudById('Masters', 'broker'),
  '/api/portfolios': {
    get: op({ summary: 'List portfolios', tags: 'Masters' })
  },

  '/api/limit-setup/limit-counterparties': {
    get: op({ summary: 'Counterparties available for limit setup', tags: 'Limits' })
  },
  '/api/limit-setup/limits': {
    post: op({ summary: 'Create limit setup', tags: 'Limits', requestBody: body() })
  },
  '/api/limit-status/status': {
    get: op({
      summary: 'Limit status for a counterparty and product',
      tags: 'Limits',
      parameters: [q('counterpartyId', 'Counterparty ID'), q('product', 'Product key')]
    })
  },

  '/api/documents/upload': {
    post: op({
      summary: 'Upload a transaction document',
      tags: 'Documents',
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: {
                transaction_type: { type: 'string' },
                transaction_id: { type: 'string' },
                document: { type: 'string', format: 'binary' },
                description: { type: 'string' }
              }
            }
          }
        }
      }
    })
  },
  '/api/documents/upload-multiple': {
    post: op({ summary: 'Upload multiple transaction documents', tags: 'Documents' })
  },
  '/api/documents/{transactionType}/{transactionId}': {
    get: op({
      summary: 'List documents for a transaction',
      tags: 'Documents',
      parameters: [p('transactionType', 'e.g. gsec, buyback, repo'), p('transactionId', 'Transaction ID')]
    })
  },
  '/api/documents/{id}/download': {
    get: op({ summary: 'Download a document', tags: 'Documents', parameters: [p('id', 'Document ID')] })
  },
  '/api/documents/{id}': {
    put: op({ summary: 'Update document metadata', tags: 'Documents', parameters: [p('id', 'Document ID')], requestBody: body() }),
    delete: op({ summary: 'Delete a document', tags: 'Documents', parameters: [p('id', 'Document ID')] })
  },

  '/api/deal-confirmation/gsec/{id}/pdf': {
    get: op({ summary: 'GSEC deal confirmation PDF', tags: 'Deal Confirmation', parameters: [p('id', 'GSEC ID')] })
  },
  '/api/deal-confirmation/gsec/{id}/docx': {
    get: op({ summary: 'GSEC deal confirmation Word', tags: 'Deal Confirmation', parameters: [p('id', 'GSEC ID')] })
  },
  '/api/deal-confirmation/buyback/{id}/pdf': {
    get: op({ summary: 'Buyback deal confirmation PDF', tags: 'Deal Confirmation', parameters: [p('id', 'Buyback ID')] })
  },
  '/api/deal-confirmation/buyback/{id}/docx': {
    get: op({ summary: 'Buyback deal confirmation Word', tags: 'Deal Confirmation', parameters: [p('id', 'Buyback ID')] })
  },
  '/api/deal-confirmation/repo/{id}/pdf': {
    get: op({ summary: 'Repo deal confirmation PDF', tags: 'Deal Confirmation', parameters: [p('id', 'Repo ID')] })
  },
  '/api/deal-confirmation/repo/{id}/docx': {
    get: op({ summary: 'Repo deal confirmation Word', tags: 'Deal Confirmation', parameters: [p('id', 'Repo ID')] })
  },

  '/api/daily-deal-blotter': {
    get: op({ summary: 'Daily deal blotter', tags: 'Blotters', parameters: [q('date', 'YYYY-MM-DD')] })
  },
  '/api/daily-transaction-blotter': {
    get: op({ summary: 'Daily transaction blotter (value date)', tags: 'Blotters', parameters: [q('date', 'YYYY-MM-DD')] })
  },
  '/api/coupon-maturity-blotter': {
    get: op({ summary: 'Coupon maturity blotter', tags: 'Blotters', parameters: [q('date', 'YYYY-MM-DD')] })
  },

  '/api/external-accounting/trial-balance': {
    get: op({ summary: 'External trial balance proxy', tags: 'External Accounting' })
  },
  '/api/external-accounting/trial-balance/account/{accountCode}': {
    get: op({
      summary: 'External trial balance for one account',
      tags: 'External Accounting',
      parameters: [p('accountCode', 'Account code')]
    })
  },
  '/api/external-accounting/gsec-entries/balance-sheet': {
    get: op({ summary: 'External GSEC balance sheet proxy', tags: 'External Accounting' })
  },
  '/api/external-accounting/gsec-entries/balance-sheet/account/{accountCode}': {
    get: op({
      summary: 'External GSEC balance sheet for one account',
      tags: 'External Accounting',
      parameters: [p('accountCode', 'Account code')]
    })
  },

  '/api/accounts': crud('Transactions', 'account'),
  '/api/accounts/{id}': crudById('Transactions', 'account'),
  '/api/securities': crud('Transactions', 'security'),
  '/api/securities/{id}': crudById('Transactions', 'security'),
  '/api/transaction-types': crud('Transactions', 'transaction type'),
  '/api/transaction-types/{id}': crudById('Transactions', 'transaction type'),
  '/api/transactions': {
    get: op({ summary: 'List transactions', tags: 'Transactions' }),
    post: op({ summary: 'Create transaction', tags: 'Transactions', requestBody: body() })
  },
  '/api/transactions/recent': {
    get: op({ summary: 'Recent transactions', tags: 'Transactions' })
  },
  '/api/transactions/test-db-write': {
    get: op({ summary: 'Database write test', tags: 'Transactions' })
  },
  '/api/transactions/account/{accountId}': {
    get: op({ summary: 'Transactions for an account', tags: 'Transactions', parameters: [p('accountId', 'Account ID')] })
  },
  '/api/transactions/{id}': {
    get: op({ summary: 'Get transaction', tags: 'Transactions', parameters: [p('id', 'Transaction ID')] }),
    put: op({
      summary: 'Update transaction',
      tags: 'Transactions',
      parameters: [p('id', 'Transaction ID or deal_number')],
      requestBody: body()
    }),
    delete: op({ summary: 'Delete transaction', tags: 'Transactions', parameters: [p('id', 'Transaction ID')] })
  }
};

module.exports = { tags, paths };
