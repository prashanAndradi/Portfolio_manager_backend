const express = require('express');
const router = express.Router();
const counterpartyCorporateController = require('../controllers/counterpartyCorporateController');
const { checkAuth } = require('../middleware/auth');
const { requireMiddleOffice } = require('../middleware/requireMiddleOffice');

// Counterparty master setup (create/edit) is Middle Office-exclusive - the
// dropdown/lookup GET routes below stay open, since every front-office user
// needs them for deal entry.
// POST /api/counterparty-corporate
router.post('/', checkAuth, requireMiddleOffice, counterpartyCorporateController.createCounterpartyCorporate);

// GET /api/counterparty-corporate
router.get('/', counterpartyCorporateController.getAllCounterpartyCorporates);

// GET /api/counterparty-corporate/:id
router.get('/:id', counterpartyCorporateController.getCounterpartyCorporateById);

// PUT /api/counterparty-corporate/:id
router.put('/:id', checkAuth, requireMiddleOffice, counterpartyCorporateController.updateCounterpartyCorporate);

module.exports = router;
