const express = require('express');
const router = express.Router();
const isinMasterController = require('../controllers/isinMasterController');

router.post('/', isinMasterController.createIsin);
router.get('/', isinMasterController.getAllIsins);
router.get('/search', isinMasterController.searchIsins);

router.get('/:id', isinMasterController.getIsinById);

// Get previous and next coupon dates for an ISIN
router.get('/:isin/coupon-dates', isinMasterController.getCouponDates);
// Get all coupon months/days (MM/DD) for an ISIN
router.get('/:isin/coupon-months', isinMasterController.getCouponMonths);

// Gsec transaction routes
router.post('/gsec', isinMasterController.saveGsec);

// Get recent Gsec transactions
router.get('/gsec/recent', isinMasterController.getRecentGsecTransactions);

// Update Gsec transaction
router.put('/gsec/:id', isinMasterController.updateGsecTransaction);

// Update Gsec transaction status (approve/reject)
router.put('/gsec/:id/status', isinMasterController.updateGsecTransactionStatus);

module.exports = router;
