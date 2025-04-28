const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');

// GET all transactions
router.get('/', transactionController.getAllTransactions);

// GET recent transactions
router.get('/recent', transactionController.getRecentTransactions);

// GET transactions by account ID
router.get('/account/:accountId', transactionController.getTransactionsByAccountId);

// GET a specific transaction
router.get('/:id', transactionController.getTransactionById);

// POST create a new transaction
router.post('/', transactionController.createTransaction);

// PUT update a transaction
router.put('/:id', transactionController.updateTransaction);

// DELETE a transaction
router.delete('/:id', transactionController.deleteTransaction);

module.exports = router;
