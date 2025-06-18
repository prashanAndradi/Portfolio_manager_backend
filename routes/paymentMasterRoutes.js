const express = require('express');
const router = express.Router();
const paymentMasterController = require('../controllers/paymentMasterController');

// GET all bank payment codes
router.get('/bank-payment-codes', paymentMasterController.getBankPaymentCodes);

// GET bank details by bank payment code
router.get('/bank-details/:code', paymentMasterController.getBankDetailsByPaymentCode);

module.exports = router;
