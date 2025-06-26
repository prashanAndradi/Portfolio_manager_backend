const express = require('express');
const router = express.Router();
const portfolioMasterRoutes = require('./portfolioMasterRoutes');
const paymentMasterRoutes = require('./paymentMasterRoutes');
const authorizerRoutes = require('./authorizerRoutes');
const settlementAccountRoutes = require('./settlementAccountRoutes');

// Portfolio Master API
router.use('/portfolio-master', portfolioMasterRoutes);
router.use('/payment-master', paymentMasterRoutes);
router.use('/authorizers', authorizerRoutes);
router.use('/settlement-accounts', settlementAccountRoutes);

module.exports = router;
