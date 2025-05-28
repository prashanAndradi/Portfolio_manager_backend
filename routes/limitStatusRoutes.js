const express = require('express');
const router = express.Router();
const limitStatusController = require('../controllers/limitStatusController');

// GET /api/limits/status - Get limit status for a counterparty and product
router.get('/status', limitStatusController.getLimitStatus);

module.exports = router;
