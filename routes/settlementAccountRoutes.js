// Routes for Settlement Account Master
const express = require('express');
const router = express.Router();
const settlementAccountController = require('../controllers/settlementAccountController');

// POST /api/settlement-accounts
router.post('/', settlementAccountController.createSettlementAccount);
// GET /api/settlement-accounts
router.get('/', settlementAccountController.getSettlementAccounts);
// PUT /api/settlement-accounts/:id
router.put('/:id', settlementAccountController.updateSettlementAccount);

module.exports = router;
