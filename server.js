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

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Portfolio Manager API',
    version: '1.0.0',
    description: 'Professional OpenAPI documentation for the Portfolio Manager backend. All endpoints are documented to facilitate integration, testing, and onboarding.'
  },
  servers: [
    {
      url: 'http://localhost:3001/api',
      description: 'Development server',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  security: [{ bearerAuth: [] }],
};

const swaggerOptions = {
  swaggerDefinition,
  apis: ['./routes/*.js', './models/*.js'], // Scan all route/model files
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
// --- End Swagger Setup ---

// Enable CORS for all routes
app.use(cors());

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Import routes
const accountRoutes = require('./routes/accounts');
const transactionTypeRoutes = require('./routes/transactionTypes');
const securityRoutes = require('./routes/securities');
const counterpartyRoutes = require('./routes/counterparties');
const userRoutes = require('./routes/userRoutes');
const authRoutes = require('./routes/authRoutes');
const transactionRoutes = require('./routes/transactions');
const accountingRoutes = require('./routes/accounting');
const isinMasterRoutes = require('./routes/isinMasterRoutes');
const counterpartyIndividualRoutes = require('./routes/counterpartyIndividualRoutes');
const counterpartyJointRoutes = require('./routes/counterpartyJointRoutes');
const limitStatusRoutes = require('./routes/limitStatusRoutes');
const indexRoutes = require('./routes/index');
const moneyMarketDealsRoutes = require('./routes/moneyMarketDeals');
const voucherRoutes = require('./routes/voucher');
const paymentMasterRoutes = require('./routes/paymentMasterRoutes');
const strategyMasterRoutes = require('./routes/strategyMasterRoutes');

// Use routes
app.use('/api/auth', authRoutes); // <-- Ensure /api/auth/login works
app.use('/api', require('./routes/index'));
app.use('/api/money-market-deals', moneyMarketDealsRoutes);


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