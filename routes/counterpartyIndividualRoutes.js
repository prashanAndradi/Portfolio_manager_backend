const express = require('express');
const router = express.Router();
const counterpartyIndividualController = require('../controllers/counterpartyIndividualController');
const { checkAuth } = require('../middleware/auth');

// Counterparty master setup (create/edit) is Middle Office-exclusive - the
// dropdown/lookup GET routes below stay open, since every front-office user
// needs them for deal entry.
// POST /api/counterparty-individual
router.post('/', checkAuth, counterpartyIndividualController.createCounterpartyIndividual);

// GET /api/counterparty-individual
router.get('/', counterpartyIndividualController.getAllCounterpartyIndividuals);

// GET /api/counterparty-individual/:id
router.get('/:id', counterpartyIndividualController.getCounterpartyIndividualById);

// PUT /api/counterparty-individual/:id
router.put('/:id', checkAuth, counterpartyIndividualController.updateCounterpartyIndividual);

module.exports = router;
