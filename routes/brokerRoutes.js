const express = require('express');
const router = express.Router();
const brokerController = require('../controllers/brokerController');

// CRUD endpoints
router.post('/', brokerController.create);
router.get('/', brokerController.getAll);
router.get('/:id', brokerController.getById);
router.put('/:id', brokerController.update);
router.delete('/:id', brokerController.remove);

module.exports = router;
