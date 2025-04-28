const express = require('express');
const router = express.Router();
const transactionTypeController = require('../controllers/transactionTypeController');

router.get('/', transactionTypeController.getAllTransactionTypes);
router.get('/:id', transactionTypeController.getTransactionTypeById);
router.post('/', transactionTypeController.createTransactionType);
router.put('/:id', transactionTypeController.updateTransactionType);
router.delete('/:id', transactionTypeController.deleteTransactionType);

module.exports = router;
