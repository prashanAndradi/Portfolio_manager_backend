const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');

// GSec report endpoint
router.get('/gsec', reportController.getGsecReport);

// Portfolio report endpoint
router.get('/portfolio', reportController.getPortfolioReport);

// Counterparty report endpoint
router.get('/counterparty', reportController.getCounterpartyReport);
router.get('/counterparty-master', reportController.getCounterpartyMasterReport);

// Buyback report endpoint
router.get('/buyback', reportController.getBuybackReport);

// Repo + Reverse Repo report endpoint
router.get('/repo', reportController.getRepoReport);

// T-Bill report endpoint
router.get('/tbill', reportController.getTbillReport);

// Broker report endpoint (GSEC + T-Bill deals with a broker assigned)
router.get('/broker', reportController.getBrokerReport);

// Daily Portfolio Balancing Report (per-ISIN opening/closing balance + custodian split)

// Per-account "as per report" figures for reconciling the external GSec trial balance
router.get('/account-figures', reportController.getAccountReportFigures);

module.exports = router;
