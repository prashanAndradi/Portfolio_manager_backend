const express = require('express');
const router = express.Router();
const counterpartyController = require('../controllers/counterpartyController');

router.get('/', counterpartyController.getAllCounterparties);
router.get('/:id', counterpartyController.getCounterpartyById);
router.post('/', counterpartyController.createCounterparty);
router.put('/:id', counterpartyController.updateCounterparty);
router.delete('/:id', counterpartyController.deleteCounterparty);

module.exports = router;
