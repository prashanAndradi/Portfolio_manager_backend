const express = require('express');
const router = express.Router();
const counterpartyJointController = require('../controllers/counterpartyJointController');

// POST /api/counterparty-joint
router.post('/counterparty-joint', counterpartyJointController.createCounterpartyJoint);

module.exports = router;
