const express = require('express');
const router = express.Router();
const counterpartyIndividualController = require('../controllers/counterpartyIndividualController');
const { checkAuth } = require('../middleware/auth');
const { requireMiddleOffice } = require('../middleware/requireMiddleOffice');

// Counterparty master setup (create/edit) is Middle Office-exclusive - the
// dropdown/lookup GET routes below stay open, since every front-office user
// needs them for deal entry.
// POST /api/counterparty-individual
router.post('/', checkAuth, requireMiddleOffice, counterpartyIndividualController.createCounterpartyIndividual);

// GET /api/counterparty-individual
router.get('/', counterpartyIndividualController.getAllCounterpartyIndividuals);

// GET /api/counterparty-individual/:id
router.get('/:id', counterpartyIndividualController.getCounterpartyIndividualById);

// PUT /api/counterparty-individual/:id
router.put('/:id', checkAuth, requireMiddleOffice, counterpartyIndividualController.updateCounterpartyIndividual);

module.exports = router;
