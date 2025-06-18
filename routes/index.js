const express = require('express');
const router = express.Router();
const portfolioMasterRoutes = require('./portfolioMasterRoutes');
const strategyMasterRoutes = require('./strategyMasterRoutes');
const settlementAccountRoutes = require('./settlementAccountRoutes');

// Portfolio Master API
router.use('/portfolio-master', portfolioMasterRoutes);
router.use('/strategy-master', strategyMasterRoutes);
router.use('/settlement-accounts', settlementAccountRoutes);

module.exports = router;
