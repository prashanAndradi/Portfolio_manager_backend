const express = require('express');
const router = express.Router();
const portfolioMasterRoutes = require('./portfolioMasterRoutes');
const strategyMasterRoutes = require('./strategyMasterRoutes');

// Portfolio Master API
router.use('/portfolio-master', portfolioMasterRoutes);
router.use('/strategy-master', strategyMasterRoutes);

module.exports = router;
