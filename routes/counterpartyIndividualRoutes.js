const express = require('express');
const router = express.Router();
const counterpartyIndividualController = require('../controllers/counterpartyIndividualController');

// POST /api/counterparty-individual
router.post('/counterparty-individual', counterpartyIndividualController.createCounterpartyIndividual);

// GET /api/counterparty-individual
router.get('/counterparty-individual', counterpartyIndividualController.getAllCounterpartyIndividuals);

module.exports = router;
