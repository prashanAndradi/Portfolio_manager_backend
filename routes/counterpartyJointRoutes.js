const express = require('express');
const router = express.Router();
const counterpartyJointController = require('../controllers/counterpartyJointController');
const { checkAuth } = require('../middleware/auth');
const { requireMiddleOffice } = require('../middleware/requireMiddleOffice');

// Counterparty master setup (create/edit) is Middle Office-exclusive - the
// dropdown/lookup GET routes below stay open, since every front-office user
// needs them for deal entry.
// POST /api/counterparty-joint
router.post('/', checkAuth, requireMiddleOffice, counterpartyJointController.createCounterpartyJoint);

// GET /api/counterparty-joint
router.get('/', counterpartyJointController.getAllCounterpartyJoints);

// GET /api/counterparty-joint/:id
router.get('/:id', counterpartyJointController.getCounterpartyJointById);

// PUT /api/counterparty-joint/:id
router.put('/:id', checkAuth, requireMiddleOffice, counterpartyJointController.updateCounterpartyJoint);

module.exports = router;
