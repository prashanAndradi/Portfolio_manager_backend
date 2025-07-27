const express = require('express');
const router = express.Router();
const portfolioMasterRoutes = require('./portfolioMasterRoutes');
const paymentMasterRoutes = require('./paymentMasterRoutes');
const authorizerRoutes = require('./authorizerRoutes');
const settlementAccountRoutes = require('./settlementAccountRoutes');
const systemDayRoutes = require('./systemDayRoutes');
const moneyMarketEodRoutes = require('./moneyMarketEodRoutes');
const accountingRoutes = require('./accounting');
const transactionsRoutes = require('./transactions');
const strategyMasterRoutes = require('./strategyMasterRoutes');

// Portfolio Master API
router.use('/portfolio-master', portfolioMasterRoutes);
router.use('/payment-master', paymentMasterRoutes);
router.use('/authorizers', authorizerRoutes);
router.use('/settlement-accounts', settlementAccountRoutes);
router.use('/system-day', systemDayRoutes);
router.use('/money-market', moneyMarketEodRoutes);
router.use('/accounting', accountingRoutes);
router.use('/transactions', transactionsRoutes);
router.use('/strategy-master', strategyMasterRoutes);

// Additional routes for full API coverage
router.use('/accounts', require('./accounts'));
router.use('/auth', require('./authRoutes'));
router.use('/brokers', require('./brokerRoutes'));
router.use('/counterparties', require('./counterparties'));
router.use('/counterparty-individual', require('./counterpartyIndividualRoutes'));
router.use('/counterparty-joint', require('./counterpartyJointRoutes'));
router.use('/isin-master', require('./isinMasterRoutes'));
router.use('/limit-setup', require('./limitSetupRoutes'));
router.use('/limit-status', require('./limitStatusRoutes'));
router.use('/money-market-deals', require('./moneyMarketDeals'));
router.use('/securities', require('./securities'));
router.use('/user', require('./userRoutes'));
// Mount voucher router under /money-market for correct nested voucher download route
router.use('/money-market', require('./voucher'));
router.use('/transaction-types', require('./transactionTypes'));
// Note: transactionRoutes.js is skipped as transactions.js is already mounted.

module.exports = router;
