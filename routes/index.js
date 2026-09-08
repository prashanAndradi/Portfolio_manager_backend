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
const reportMoneyMarketRoutes = require('./reportMoneyMarket');
const reportMarkToMarketRoutes = require('./reportMarkToMarket');
const reportBuybackRoutes = require('./reportBuyback');
const reportSellTransactionRoutes = require('./reportSellTransaction');
const reportRoutes = require('./reportRoutes');
const markToMarketRoutes = require('./markToMarketRoutes');
const cashflowRoutes = require('./cashflowRoutes');

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
router.use('/mark-to-market', markToMarketRoutes);

// Additional routes for full API coverage
router.use('/accounts', require('./accounts'));
router.use('/auth', require('./authRoutes'));
router.use('/brokers', require('./brokerRoutes'));
router.use('/buyback', require('./buybackRoutes'));
router.use('/counterparties', require('./counterparties'));
router.use('/counterparty-individual', require('./counterpartyIndividualRoutes'));
router.use('/counterparty-joint', require('./counterpartyJointRoutes'));
router.use('/counterparty-corporate', require('./counterpartyCorporateRoutes'));
router.use('/isin-master', require('./isinMasterRoutes'));
router.use('/limit-setup', require('./limitSetupRoutes'));
router.use('/limit-status', require('./limitStatusRoutes'));
router.use('/dealer-limits', require('./dealerLimitRoutes'));
router.use('/notifications', require('./notificationRoutes'));
router.use('/money-market-deals', require('./moneyMarketDeals'));
router.use('/repo-deals', require('./repoRoutes'));
router.use('/securities', require('./securities'));
router.use('/user', require('./userRoutes'));
router.use('/cashflow', cashflowRoutes);
router.use('/vouchers', require('./vouchers'));
// Mount voucher router under /money-market for correct nested voucher download route
router.use('/money-market', require('./voucher'));
router.use('/transaction-types', require('./transactionTypes'));
// Note: transactionRoutes.js is skipped as transactions.js is already mounted.

// Mount report APIs (using centralized reportRoutes)
router.use('/reports', reportRoutes);

// Mount Money Market report API (legacy, kept for backward compatibility)
router.use('/reports/money-market', reportMoneyMarketRoutes);

// Mount Mark to Market report API (legacy, kept for backward compatibility)
router.use('/reports/mark-to-market', reportMarkToMarketRoutes);

// Mount Sell Transaction report API (legacy, kept for backward compatibility)
router.use('/reports/sell-transaction', reportSellTransactionRoutes);

// Mount GSec workflow API
router.use('/gsec', require('./gsecRoutes'));

// Mount Deal Confirmation document generation API (PDF/Word for GSEC, Buyback, Repo)
router.use('/deal-confirmation', require('./dealConfirmationRoutes'));

// Mount Coupon Maturity Blotter API
router.use('/coupon-maturity-blotter', require('./couponMaturityBlotterRoutes'));

// Mount Daily Deal Blotter API
router.use('/daily-deal-blotter', require('./dailyDealBlotterRoutes'));

// Mount Daily Transaction Blotter API (value-date)
router.use('/daily-transaction-blotter', require('./dailyTransactionBlotterRoutes'));

// Mount Holiday Calendar API
router.use('/holiday-calendar', require('./holidayCalendarRoutes'));

// Mount Fund Centre Master API
router.use('/fund-centre-master', require('./fundCentreMasterRoutes'));

// T-Bill deals
router.use('/tbill', require('./tbillRoutes'));

// Mount Issuer Master API
router.use('/issuer-master', require('./issuerMasterRoutes'));

// Mount Investment Approver Master API
router.use('/investment-approver-master', require('./investmentApproverMasterRoutes'));

// Mount External Accounting proxy (Trial Balance / GSec Balance Sheet) - avoids
// browser CORS by relaying server-to-server to the external accounting API.
router.use('/external-accounting', require('./externalAccountingRoutes'));

module.exports = router;
