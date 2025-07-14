const express = require('express');
const router = express.Router();
const paymentMasterController = require('../controllers/paymentMasterController');

// GET all bank payment codes
router.get('/bank-payment-codes', paymentMasterController.getBankPaymentCodes);

// GET bank details by bank payment code
router.get('/bank-details/:code', paymentMasterController.getBankDetailsByPaymentCode);

// POST create new Payment Master record
router.post('/', paymentMasterController.createPaymentMaster);

// GET all Payment Master records
router.get('/', paymentMasterController.getAllPaymentMasters);

// GET search Payment Master records
router.get('/search', paymentMasterController.searchPaymentMasters);

// PUT update Payment Master record by ID
router.put('/:id', paymentMasterController.updatePaymentMaster);

// GET payment methods
router.get('/methods', paymentMasterController.getPaymentMethods);

module.exports = router;
