const express = require('express');
const router = express.Router();
const limitSetupController = require('../controllers/limitSetupController');

// Get all counterparties (individual + joint)
router.get('/limit-counterparties', limitSetupController.getAllCounterparties);

// Save a new limit setup
router.post('/limits', limitSetupController.createLimit);

module.exports = router;
