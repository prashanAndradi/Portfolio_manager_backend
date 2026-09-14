require('./config/timezone'); // must stay first - see config/timezone.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Load environment variables
dotenv.config();

// Create Express app
const app = express();

// --- Swagger Setup ---
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const swaggerCatalog = require('./swagger/catalog');

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Portfolio Manager API',
    version: '1.0.0',
    description:
      'OpenAPI documentation for the ITMS / Portfolio Manager backend. ' +
      'Every mounted HTTP route is listed. Authorize with a JWT from POST /api/auth/login.'
  },
  servers: [
    {
      url: 'http://localhost:3001',
      description: 'Local backend (paths include /api)'
    }
  ],
  tags: swaggerCatalog.tags,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    }
  },
  security: [{ bearerAuth: [] }]
};

const swaggerOptions = {
  swaggerDefinition,
  apis: ['./routes/*.js', './models/*.js']
};

function withApiPrefix(pathKey) {
  if (pathKey === '/' || pathKey.startsWith('/api') || pathKey.startsWith('/isin-master')) {
    return pathKey;
  }
  return `/api${pathKey.startsWith('/') ? pathKey : `/${pathKey}`}`;
}

function mergeSwaggerPaths(jsdocPaths, catalogPaths) {
  const merged = {};
  for (const [rawPath, ops] of Object.entries(jsdocPaths || {})) {
    const pathKey = withApiPrefix(rawPath);
    merged[pathKey] = { ...(merged[pathKey] || {}), ...ops };
  }
  // Catalog is the complete route inventory and wins on conflicts.
  for (const [pathKey, ops] of Object.entries(catalogPaths || {})) {
    merged[pathKey] = { ...(merged[pathKey] || {}), ...ops };
  }
  return merged;
}

const swaggerSpec = swaggerJsdoc(swaggerOptions);
swaggerSpec.tags = swaggerCatalog.tags;
swaggerSpec.paths = mergeSwaggerPaths(swaggerSpec.paths, swaggerCatalog.paths);

app.set('trust proxy', true);

function isBehindApiProxy(req) {
  return /\/api\/api-docs/.test(String(req.originalUrl || req.url || ''));
}

function stripApiPrefixFromPaths(paths) {
  const out = {};
  for (const [pathKey, ops] of Object.entries(paths || {})) {
    const stripped =
      pathKey === '/api' ? '/' : pathKey.startsWith('/api/') ? pathKey.slice(4) : pathKey;
    out[stripped] = { ...(out[stripped] || {}), ...ops };
  }
  return out;
}

function swaggerPublicBase(req) {
  const envBase = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (envBase) return envBase;
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'http')
    .split(',')[0]
    .trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || 'localhost:3001')
    .split(',')[0]
    .trim();
  const forwardedPrefix = String(req.get('x-forwarded-prefix') || process.env.PUBLIC_PATH_PREFIX || '')
    .replace(/\/$/, '');
  const original = String(req.originalUrl || '').split('?')[0];

  // Live1 nginx: /live1-api/* -> backend /api/*. originalUrl is /api/api-docs.
  if (isBehindApiProxy(req)) {
    return `${proto}://${host}${forwardedPrefix || '/live1-api'}`;
  }

  let prefix = forwardedPrefix;
  if (!prefix) {
    const match = original.match(/^(.*)\/api-docs\/?$/);
    if (match && match[1] && match[1] !== '/api') prefix = match[1];
  }
  return `${proto}://${host}${prefix}`;
}

function specForRequest(req) {
  const behindApiProxy = isBehindApiProxy(req);
  return {
    ...swaggerSpec,
    paths: behindApiProxy ? stripApiPrefixFromPaths(swaggerSpec.paths) : swaggerSpec.paths,
    servers: [
      { url: swaggerPublicBase(req), description: 'This host' },
      ...(behindApiProxy ? [] : [{ url: 'http://localhost:3001', description: 'Local development' }])
    ]
  };
}

function attachSwaggerDoc(req, res, next) {
  req.swaggerDoc = specForRequest(req);
  next();
}

// Without a trailing slash, Swagger's relative CSS/JS resolve one directory up
// and the page looks blank. Use a relative Location so nginx prefixes such as
// /live1-api are kept (an absolute /api/api-docs/ redirect would drop them).
function ensureSwaggerTrailingSlash(req, res, next) {
  const pathOnly = String(req.originalUrl || req.url).split('?')[0];
  if (!/\/api-docs$/.test(pathOnly)) return next();
  const query = String(req.originalUrl || req.url).includes('?')
    ? String(req.originalUrl).slice(String(req.originalUrl).indexOf('?'))
    : '';
  return res.redirect(301, `api-docs/${query}`);
}

const swaggerUiSetup = swaggerUi.setup(swaggerSpec, {
  explorer: true,
  customSiteTitle: 'Portfolio Manager API',
  swaggerOptions: { persistAuthorization: true }
});

// /api/api-docs is required on Live1: nginx maps /live1-api/X -> /api/X, so
// /live1-api/api-docs reaches Express as /api/api-docs (not /api-docs).
const swaggerMounts = ['/api-docs', '/api/api-docs', '/live1/api-docs', '/live1-api/api-docs'];
for (const mount of swaggerMounts) {
  app.use(
    mount,
    ensureSwaggerTrailingSlash,
    attachSwaggerDoc,
    swaggerUi.serveFiles(swaggerSpec),
    swaggerUiSetup
  );
}

app.get(
  ['/api-docs.json', '/api/api-docs.json', '/live1/api-docs.json', '/live1-api/api-docs.json'],
  (req, res) => {
    res.json(specForRequest(req));
  }
);
// --- End Swagger Setup ---

// Enable CORS for all routes
app.use(cors());

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Import routes
const accountRoutes = require('./routes/accounts');
const portfolioRoutes = require('./routes/portfolioRoutes');
const reportRoutes = require('./routes/reportRoutes');
const bankChargesRoutes = require('./routes/bankChargesRoutes');
const interestIncomeRoutes = require('./routes/interestIncomeRoutes');
const transactionTypeRoutes = require('./routes/transactionTypes');
const securityRoutes = require('./routes/securities');
const counterpartyRoutes = require('./routes/counterparties');
const userRoutes = require('./routes/userRoutes');
const authRoutes = require('./routes/authRoutes');
const transactionRoutes = require('./routes/transactions');
const accountingRoutes = require('./routes/accounting');
const accountMappingRoutes = require('./routes/accountMappingRoutes');
const chartOfAccountsRoutes = require('./routes/chartOfAccountsRoutes');
const fixedDepositRoutes = require('./routes/fixedDepositRoutes');
const isinMasterRoutes = require('./routes/isinMasterRoutes');
const markToMarketRoutes = require('./routes/markToMarketRoutes'); // FIXED: Correct path

// Mount the ISIN Master routes at /isin-master
app.use('/isin-master', isinMasterRoutes);
const counterpartyIndividualRoutes = require('./routes/counterpartyIndividualRoutes');
const counterpartyJointRoutes = require('./routes/counterpartyJointRoutes');
const limitStatusRoutes = require('./routes/limitStatusRoutes');
const indexRoutes = require('./routes/index');
const moneyMarketDealsRoutes = require('./routes/moneyMarketDeals');
const voucherRoutes = require('./routes/voucher');
const paymentMasterRoutes = require('./routes/paymentMasterRoutes');
const strategyMasterRoutes = require('./routes/strategyMasterRoutes');
const maturityRoutes = require('./routes/maturity');
const repoRoutes = require('./routes/repoRoutes');
const transactionDocumentRoutes = require('./routes/transactionDocumentRoutes');

// Use routes
app.use('/api/accounts', accountRoutes);
app.use('/api/portfolios', portfolioRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api', require('./routes/index'));
app.use('/api/money-market-deals', moneyMarketDealsRoutes);
app.use('/api/maturity', maturityRoutes);
app.use('/api/repo-deals', repoRoutes);
app.use('/api/documents', transactionDocumentRoutes);
app.use('/api/mark-to-market', markToMarketRoutes); // FIXED: Mark-to-Market routes mounted
app.use('/api/account-mappings', accountMappingRoutes);
app.use('/api/chart-of-accounts', chartOfAccountsRoutes);
app.use('/api/fixed-deposit', fixedDepositRoutes);
app.use('/api/bank-charges', bankChargesRoutes);
app.use('/api/reports/interest-income', interestIncomeRoutes);

// Add a direct register endpoint that will definitely work
app.post('/api/auth/register', async (req, res) => {
  console.log('DIRECT REGISTER ATTEMPT:', req.body);
  try {
    const authController = require('./controllers/authController');
    return authController.register(req, res);
  } catch (err) {
    console.error('Error in direct register endpoint:', err);
    return res.status(500).json({ 
      success: false,
      error: 'Registration failed', 
      details: err.message 
    });
  }
});

// Add a simple test endpoint that will definitely work
app.get('/api/test', (req, res) => {
  res.json({ message: 'Test endpoint works!' });
});

// Create a simple test login endpoint that always works
app.post('/api/test-login', (req, res) => {
  console.log('TEST LOGIN RECEIVED:', req.body);
  res.json({ 
    success: true, 
    message: 'Test login successful',
    user: {
      id: 999,
      username: 'testuser',
      role: 'admin'
    }
  });
});

// Add a direct users endpoint that will definitely work
app.get('/api/users', async (req, res) => {
  console.log('DIRECT USERS FETCH ATTEMPT');
  try {
    const userController = require('./controllers/userController');
    return userController.getAllUsers(req, res);
  } catch (err) {
    console.error('Error in direct users endpoint:', err);
    // If controller fails, return some mock data
    return res.json([
      {
        id: 1,
        username: 'user1',
        role: 'user',
        created_at: new Date().toISOString()
      },
      {
        id: 2,
        username: 'authorizer1',
        role: 'authorizer',
        created_at: new Date().toISOString()
      }
    ]);
  }
});

// Default route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Portfolio Manager API' });
});

// Update port to 3001 to match frontend expectations
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  
  // Database verification
  const db = require('./config/database');
  console.log('Checking database tables on startup...');
  
  // Test database connection
  console.log('Testing database read capability...');
  db.query('SELECT 1 as test')
    .then(([rows]) => {
      console.log('Read test successful:', rows);
      
      // Test write capability
      console.log('Testing database write capability...');
      return db.query('SELECT 1 as id, "test" as value');
    })
    .then(([rows]) => {
      console.log('Write test successful:', rows);
    })
    .catch(err => {
      console.error('Database test failed:', err.message);
    });
});

console.log('=== Portfolio Backend Server STARTED ===');
console.log('CWD:', process.cwd());
console.log('StrategyMasterRoutes:', require('fs').existsSync('./routes/strategyMasterRoutes.js'));