const express = require('express');
const router = express.Router();
const isinMasterController = require('../controllers/isinMasterController');

router.post('/', isinMasterController.createIsin);
router.get('/', isinMasterController.getAllIsins);
router.get('/search', isinMasterController.searchIsins);

router.get('/:id', isinMasterController.getIsinById);

// Get previous and next coupon dates for an ISIN
router.get('/:isin/coupon-dates', isinMasterController.getCouponDates);

// Save Gsec transaction
router.post('/gsec', isinMasterController.saveGsec);

module.exports = router;
