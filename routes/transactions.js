const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');

// Get all transactions
router.get('/', transactionController.getAllTransactions);

// Test database write
router.get('/test-db-write', transactionController.testDatabaseWrite);

// Get recent transactions
router.get('/recent', transactionController.getRecentTransactions);

// Get transactions for a specific account
router.get('/account/:accountId', transactionController.getTransactionsByAccountId);

// Get transaction by ID
router.get('/:id', transactionController.getTransactionById);

// Create new transaction
router.post('/', transactionController.createTransaction);

// Update transaction
router.put('/:id', transactionController.updateTransaction);

// Delete transaction
router.delete('/:id', transactionController.deleteTransaction);

module.exports = router; 