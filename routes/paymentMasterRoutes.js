const express = require('express');
const router = express.Router();
const paymentMasterController = require('../controllers/paymentMasterController');

// Add debugging middleware
router.use((req, res, next) => {
  console.log(`Payment Master Route: ${req.method} ${req.path}`);
  console.log('Request body:', req.body);
  next();
});

// Temporary test route
router.get('/test', (req, res) => {
  res.json({ message: 'Payment master routes are working!' });
});

// GET all bank payment codes
router.get('/bank-payment-codes', (req, res) => {
  console.log('Accessing bank payment codes route');
  paymentMasterController.getBankPaymentCodes(req, res);
});

// GET bank details by bank payment code
router.get('/bank-details/:code', (req, res) => {
  console.log('Accessing bank details route with code:', req.params.code);
  paymentMasterController.getBankDetailsByPaymentCode(req, res);
});

// POST create new Payment Master record
router.post('/', (req, res) => {
  console.log('Accessing POST payment master route');
  console.log('Request body:', req.body);
  
  // Check if controller exists
  if (!paymentMasterController.createPaymentMaster) {
    console.error('createPaymentMaster method not found in controller');
    return res.status(500).json({ error: 'Controller method not found' });
  }
  
  paymentMasterController.createPaymentMaster(req, res);
});

// GET all Payment Master records
router.get('/', paymentMasterController.getAllPaymentMasters);

// GET search Payment Master records
router.get('/search', paymentMasterController.searchPaymentMasters);

// PUT update Payment Master record by ID
router.put('/:id', paymentMasterController.updatePaymentMaster);

// GET payment methods
router.get('/methods', paymentMasterController.getPaymentMethods);

module.exports = router;