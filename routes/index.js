const express = require('express');
const router = express.Router();
const portfolioMasterRoutes = require('./portfolioMasterRoutes');
const paymentMasterRoutes = require('./paymentMasterRoutes');
const authorizerRoutes = require('./authorizerRoutes');
const settlementAccountRoutes = require('./settlementAccountRoutes');
const systemDayRoutes = require('./systemDayRoutes');
const moneyMarketEodRoutes = require('./moneyMarketEodRoutes');
const accountingRoutes = require('./accounting');

// Portfolio Master API
router.use('/portfolio-master', portfolioMasterRoutes);
router.use('/payment-master', paymentMasterRoutes);
router.use('/authorizers', authorizerRoutes);
router.use('/settlement-accounts', settlementAccountRoutes);
router.use('/system-day', systemDayRoutes);
router.use('/money-market', moneyMarketEodRoutes);
router.use('/accounting', accountingRoutes);

module.exports = router;
