const express = require('express');
const router = express.Router();
const accountMappingService = require('../services/accountMappingService');
const db = require('../config/database');

/**
 * @swagger
 * /api/account-mappings:
 *   get:
 *     summary: Get all account mappings
 *     tags: [Account Mappings]
 *     responses:
 *       200:
 *         description: List of all account mappings
 */
router.get('/', async (req, res) => {
  try {
    const mappings = await accountMappingService.getAllMappings();
    res.json({ success: true, data: mappings });
  } catch (error) {
    console.error('Error fetching account mappings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @swagger
 * /api/account-mappings/{mappingKey}:
 *   get:
 *     summary: Get account code for a specific mapping key
 *     tags: [Account Mappings]
 *     parameters:
 *       - in: path
 *         name: mappingKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Account code for the mapping key
 */
router.get('/:mappingKey', async (req, res) => {
  try {
    const { mappingKey } = req.params;
    const accountCode = await accountMappingService.getAccountCode(mappingKey);
    res.json({ success: true, mappingKey, accountCode });
  } catch (error) {
    console.error(`Error getting account code for ${req.params.mappingKey}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @swagger
 * /api/account-mappings:
 *   post:
 *     summary: Create or update an account mapping
 *     tags: [Account Mappings]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mappingKey
 *               - accountCode
 *             properties:
 *               mappingKey:
 *                 type: string
 *               accountCode:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Mapping created/updated successfully
 */
router.post('/', async (req, res) => {
  try {
    const { mappingKey, accountCode, description } = req.body;
    
    if (!mappingKey || !accountCode) {
      return res.status(400).json({ 
        success: false, 
        error: 'mappingKey and accountCode are required' 
      });
    }
    
    // Verify account exists
    const [accounts] = await db.query(
      'SELECT id, name FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
      [accountCode]
    );
    
    if (accounts.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: `Account code ${accountCode} does not exist in chart_of_accounts` 
      });
    }
    
    await accountMappingService.setAccountMapping(mappingKey, accountCode, description);
    
    res.json({ 
      success: true, 
      message: `Account mapping updated: ${mappingKey} -> ${accountCode}`,
      mapping: {
        mappingKey,
        accountCode,
        accountName: accounts[0].name,
        description
      }
    });
  } catch (error) {
    console.error('Error setting account mapping:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @swagger
 * /api/account-mappings/bulk:
 *   post:
 *     summary: Bulk update account mappings
 *     tags: [Account Mappings]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mappings:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - mappingKey
 *                     - accountCode
 *     responses:
 *       200:
 *         description: Mappings updated successfully
 */
router.post('/bulk', async (req, res) => {
  try {
    const { mappings } = req.body;
    
    if (!Array.isArray(mappings)) {
      return res.status(400).json({ 
        success: false, 
        error: 'mappings must be an array' 
      });
    }
    
    const results = [];
    const errors = [];
    
    for (const mapping of mappings) {
      try {
        if (!mapping.mappingKey || !mapping.accountCode) {
          errors.push({ mapping, error: 'mappingKey and accountCode are required' });
          continue;
        }
        
        await accountMappingService.setAccountMapping(
          mapping.mappingKey, 
          mapping.accountCode, 
          mapping.description
        );
        
        results.push({ mappingKey: mapping.mappingKey, accountCode: mapping.accountCode });
      } catch (error) {
        errors.push({ mapping, error: error.message });
      }
    }
    
    res.json({ 
      success: true, 
      message: `Updated ${results.length} mapping(s)`,
      updated: results,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error in bulk update:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @swagger
 * /api/account-mappings/keys:
 *   get:
 *     summary: Get all available mapping keys
 *     tags: [Account Mappings]
 *     responses:
 *       200:
 *         description: List of all available mapping keys
 */
router.get('/keys/all', async (req, res) => {
  try {
    res.json({ 
      success: true, 
      mappingKeys: accountMappingService.MAPPING_KEYS,
      descriptions: {
        GSEC_ASSET_TBONDS: 'GSEC Asset - Treasury Bonds',
        GSEC_DEFAULT_SETTLEMENT: 'GSEC Default Settlement Account',
        GSEC_ACCRUAL_ASSET: 'Interest Receivable TBonds Coupon - Trading (daily accrual) (131-101-350-116-44)',
        GSEC_ACCRUAL_INCOME: 'Interest Received Treasury Bonds Coupons - Trading (daily accrual) (358-101-130-404-44)',
        GSEC_COUPON_INCOME: 'Interest Received Treasury Bonds Coupons - Trading (coupon settlement) (358-101-130-404-44)',
        GSEC_AMORTISATION_TRADING: 'Amortised Discount Received/Premium Paid TBonds - Trading (daily amortisation P&L) (358-101-130-416-44)',
        GSEC_FINANCIAL_ASSETS_AMORTISED_COST: 'Amortised Discount Receivable/Premium Payable TBond - Trading (daily amortisation; cleared at sale/maturity) (131-101-350-134-44)',
        FD_ACCRUAL_ASSET: 'Fixed Deposit Daily Accrual Asset',
        FD_ACCRUAL_INCOME: 'Fixed Deposit Daily Accrual Income',
        MM_LENDING_CONTROL: 'Money Market Lending Control Account',
        MM_LOAN_LIABILITY: 'Money Market Loan Liability Account',
        MM_LENDING_INTEREST_ASSET: 'Money Market Lending Interest Asset',
        MM_LENDING_INTEREST_INCOME: 'Money Market Lending Interest Income',
        MM_BORROWING_INTEREST_EXPENSE: 'Money Market Borrowing Interest Expense',
        MM_BORROWING_INTEREST_LIABILITY: 'Money Market Borrowing Interest Liability',
        REPO_REVERSE_REPO_ASSET: 'Reverse Repo with Banks and Other Financial Institutes (131-101-410-206-44)',
        REPO_INTEREST_RECEIVABLE: 'Interest Receivable on Rev Repo with Banks and Other Financial Institutes (daily accrual) (131-101-350-222-44)',
        REPO_INTEREST_INCOME: 'Interest Received on R/Repo with Banks and Other Financial Institutes (467-101-190-440-44)',
        REVERSE_REPO_LIABILITY: 'Repo with Banks and Other Financial Institutes (249-101-330-308-44)',
        REVERSE_REPO_INTEREST_PAYABLE: 'Interest Payable on Repo with Banks and Other Financial Institutes (daily accrual) (249-101-330-314-44)',
        REVERSE_REPO_INTEREST_EXPENSE: 'Interest Paid on Repo with Banks and Other Financial Institutes (669-101-240-752-44)'
      }
    });
  } catch (error) {
    console.error('Error getting mapping keys:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
