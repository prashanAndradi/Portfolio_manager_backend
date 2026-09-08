const MaturityAmountService = require('../services/maturityAmountService');
const CashflowCaptureService = require('../services/cashflowCaptureService');
const { postRepoMaturityLedger } = require('../services/repoMaturityLedgerService');
const { resolveRequestUserId } = require('../utils/requestUser');

const toYmd = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const str = String(value);
  const first10 = str.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(first10)) return first10;
  const parsed = new Date(str);
  if (isNaN(parsed.getTime())) return null;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const MaturityController = {
  // Get money market maturities up to a specific date
  getMoneyMarketMaturities: async (req, res) => {
    try {
      const { date } = req.query;
      
      if (!date) {
        return res.status(400).json({
          success: false,
          error: 'Date parameter is required'
        });
      }

      // Validate date format
      const selectedDate = new Date(date);
      if (isNaN(selectedDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD'
        });
      }

      // Import the model dynamically to avoid circular dependencies
      const MoneyMarketDeal = require('../models/moneyMarketDealModel');
      
      const maturities = await MoneyMarketDeal.getMaturitiesByDate(selectedDate);
      
      res.json({
        success: true,
        data: maturities,
        message: `Found ${maturities.length} money market deals maturing up to ${date}`
      });

    } catch (error) {
      console.error('Error fetching money market maturities:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch money market maturities: ' + error.message
      });
    }
  },

  // Get fixed income GSEC maturities up to a specific date
  getFixedIncomeGsecMaturities: async (req, res) => {
    try {
      const { date } = req.query;
      
      if (!date) {
        return res.status(400).json({
          success: false,
          error: 'Date parameter is required'
        });
      }

      // Validate date format
      const selectedDate = new Date(date);
      if (isNaN(selectedDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD'
        });
      }

      // Import the model dynamically to avoid circular dependencies
      const GsecDeal = require('../models/gsec');
      
      const maturities = await GsecDeal.getMaturitiesByDate(selectedDate);
      
      res.json({
        success: true,
        data: maturities,
        message: `Found ${maturities.length} GSEC deals maturing up to ${date}`
      });

    } catch (error) {
      console.error('Error fetching GSEC maturities:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch GSEC maturities: ' + error.message
      });
    }
  },

  // Get maturity summary for both product types
  getMaturitySummary: async (req, res) => {
    try {
      const { date } = req.query;
      
      if (!date) {
        return res.status(400).json({
          success: false,
          error: 'Date parameter is required'
        });
      }

      // Validate date format
      const selectedDate = new Date(date);
      if (isNaN(selectedDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD'
        });
      }

      // Import models dynamically
      const MoneyMarketDeal = require('../models/moneyMarketDealModel');
      const GsecDeal = require('../models/gsec');
      
      // Get maturities for both product types
      const [moneyMarketMaturities, gsecMaturities] = await Promise.all([
        MoneyMarketDeal.getMaturitiesByDate(selectedDate),
        GsecDeal.getMaturitiesByDate(selectedDate)
      ]);

      // Calculate summary statistics
      const summary = {
        moneyMarket: {
          totalDeals: moneyMarketMaturities.length,
          totalPrincipal: moneyMarketMaturities.reduce((sum, deal) => sum + (parseFloat(deal.principal_amount) || 0), 0),
          deals7Days: moneyMarketMaturities.filter(deal => {
            const daysToMaturity = Math.floor((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
            return daysToMaturity <= 7;
          }).length,
          deals30Days: moneyMarketMaturities.filter(deal => {
            const daysToMaturity = Math.floor((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
            return daysToMaturity <= 30;
          }).length
        },
        gsec: {
          totalDeals: gsecMaturities.length,
          totalFaceValue: gsecMaturities.reduce((sum, deal) => sum + (parseFloat(deal.face_value) || 0), 0),
          deals7Days: gsecMaturities.filter(deal => {
            const daysToMaturity = Math.floor((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
            return daysToMaturity <= 7;
          }).length,
          deals30Days: gsecMaturities.filter(deal => {
            const daysToMaturity = Math.floor((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
            return daysToMaturity <= 30;
          }).length
        },
        total: {
          totalDeals: moneyMarketMaturities.length + gsecMaturities.length,
          totalValue: moneyMarketMaturities.reduce((sum, deal) => sum + (parseFloat(deal.principal_amount) || 0), 0) +
                     gsecMaturities.reduce((sum, deal) => sum + (parseFloat(deal.face_value) || 0), 0)
        }
      };
      
      res.json({
        success: true,
        data: summary,
        message: `Maturity summary for ${date}`
      });

    } catch (error) {
      console.error('Error fetching maturity summary:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch maturity summary: ' + error.message
      });
    }
  },

  // Get maturity amounts for deals
  getMaturityAmounts: async (req, res) => {
    try {
      const { dealIds, processDate } = req.query;
      
      if (!dealIds) {
        return res.status(400).json({ 
          success: false, 
          error: 'dealIds parameter is required' 
        });
      }
      
      const dealIdArray = Array.isArray(dealIds) ? dealIds : dealIds.split(',');
      const targetDate = processDate || new Date().toISOString().slice(0, 10);
      
      const maturityAmounts = await MaturityAmountService.getMaturityAmounts(dealIdArray, targetDate);
      
      return res.json({
        success: true,
        data: maturityAmounts,
        message: `Retrieved maturity amounts for ${maturityAmounts.length} deals`
      });
    } catch (error) {
      console.error('Error fetching maturity amounts:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch maturity amounts: ' + error.message 
      });
    }
  },

  // Get deal details for maturity method 2 (principal reinvestment)
  getDealDetailsForReinvestment: async (req, res) => {
    try {
      const { dealId, productType } = req.query;
      
      if (!dealId || !productType) {
        return res.status(400).json({ 
          success: false, 
          error: 'dealId and productType parameters are required' 
        });
      }

      const db = require('../config/database');
      let dealDetails = null;
      let interestAmount = 0;

      // Fetch deal details based on product type
      if (productType === 'money_market') {
        const MoneyMarketDeal = require('../models/moneyMarketDealModel');
        const [rows] = await db.query(`
          SELECT 
            mmd.id,
            mmd.deal_number,
            mmd.principal_amount,
            mmd.interest_rate,
            mmd.maturity_date,
            mmd.counterparty_id,
            mmd.currency,
            mmd.product_type,
            COALESCE(
              corp.short_name,
              ind.short_name,
              joint.short_name,
              mmd.counterparty_id
            ) as counterparty_name
          FROM money_market_deals mmd
          LEFT JOIN counterparty_master_corporate corp ON mmd.counterparty_id = corp.id
          LEFT JOIN counterparty_master_individual ind ON mmd.counterparty_id = ind.id
          LEFT JOIN counterparty_master_joint joint ON mmd.counterparty_id = joint.id
          WHERE mmd.id = ?
        `, [dealId]);

        if (rows.length > 0) {
          const deal = rows[0];
          const principalAmount = parseFloat(deal.principal_amount);
          const interestRate = parseFloat(deal.interest_rate) / 100;
          const daysToMaturity = Math.floor((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
          interestAmount = (principalAmount * interestRate * daysToMaturity) / 365;

          dealDetails = {
            product_type: 'money_market',
            original_deal_id: deal.id,
            original_deal_number: deal.deal_number,
            principal_amount: principalAmount,
            interest_amount: interestAmount,
            interest_rate: deal.interest_rate,
            maturity_date: deal.maturity_date,
            counterparty_id: deal.counterparty_id,
            counterparty_name: deal.counterparty_name,
            currency: deal.currency,
            product_type_name: deal.product_type
          };
        }
      } else if (productType === 'gsec') {
        const [rows] = await db.query(`
          SELECT 
            g.id,
            g.deal_number,
            g.face_value,
            g.settlement_amount,
            g.accrued_interest,
            g.maturity_date,
            g.counterparty,
            g.currency,
            g.isin
          FROM gsec g
          WHERE g.id = ?
        `, [dealId]);

        if (rows.length > 0) {
          const deal = rows[0];
          const faceValue = parseFloat(deal.face_value);
          const accruedInterest = parseFloat(deal.accrued_interest || 0);
          const settlementAmount = parseFloat(deal.settlement_amount || 0);
          interestAmount = accruedInterest;

          dealDetails = {
            product_type: 'gsec',
            original_deal_id: deal.id,
            original_deal_number: deal.deal_number,
            principal_amount: faceValue,
            interest_amount: interestAmount,
            settlement_amount: settlementAmount,
            maturity_date: deal.maturity_date,
            counterparty: deal.counterparty,
            currency: deal.currency,
            isin: deal.isin
          };
        }
      } else if (productType === 'repo') {
        const [rows] = await db.query(`
          SELECT 
            rd.id,
            rd.principal_amount,
            rd.interest_amount,
            rd.maturity_amount,
            rd.rate,
            rd.maturity_date,
            rd.counterparty_id,
            rd.isin_number,
            COALESCE(
              corp.short_name,
              ind.short_name,
              joint.short_name,
              rd.counterparty_id
            ) as counterparty_name
          FROM repo_deals rd
          LEFT JOIN counterparty_master_corporate corp ON rd.counterparty_id = corp.id
          LEFT JOIN counterparty_master_individual ind ON rd.counterparty_id = ind.id
          LEFT JOIN counterparty_master_joint joint ON rd.counterparty_id = joint.id
          WHERE rd.id = ?
        `, [dealId]);

        if (rows.length > 0) {
          const deal = rows[0];
          const principalAmount = parseFloat(deal.principal_amount);
          const interestAmount = parseFloat(deal.interest_amount);

          dealDetails = {
            product_type: 'repo',
            original_deal_id: deal.id,
            original_deal_number: deal.id, // repo uses id as deal number
            principal_amount: principalAmount,
            interest_amount: interestAmount,
            maturity_amount: parseFloat(deal.maturity_amount),
            rate: deal.rate,
            maturity_date: deal.maturity_date,
            counterparty_id: deal.counterparty_id,
            counterparty_name: deal.counterparty_name,
            isin_number: deal.isin_number
          };
        }
      }

      if (!dealDetails) {
        return res.status(404).json({
          success: false,
          error: 'Deal not found'
        });
      }

      return res.json({
        success: true,
        data: dealDetails,
        message: 'Deal details retrieved for reinvestment'
      });
    } catch (error) {
      console.error('Error fetching deal details for reinvestment:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch deal details: ' + error.message 
      });
    }
  }
};

// Create accounting entries for borrowing interest payment with principal reinvestment
async function createBorrowingInterestPaymentPrincipalReinvest(connection, deal, principalAmount, interestAmount, bankAccountId, processDate) {
  // Get account IDs
  const [liabilityAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '2%' AND name LIKE '%liability%' 
    LIMIT 1
  `);
  
  const [interestExpenseAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '9%' AND name LIKE '%interest%expense%' 
    LIMIT 1
  `);
  
  const [interestPayableAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '2%' AND name LIKE '%interest%payable%' 
    LIMIT 1
  `);
  
  const [interestAccrualAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '8%' AND name LIKE '%interest%accrual%' 
    LIMIT 1
  `);
  
  // Interest payment entries
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, ?, 0, 'LKR', ?)
  `, [deal.deal_number, interestExpenseAccount[0].id, processDate, interestAmount, `Interest payment for deal ${deal.deal_number}`]);
  
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, 0, ?, 'LKR', ?)
  `, [deal.deal_number, bankAccountId, processDate, interestAmount, `Interest payment from bank for deal ${deal.deal_number}`]);
  
  // Principal reinvestment entries (no bank movement, just internal transfer)
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, ?, 0, 'LKR', ?)
  `, [deal.deal_number, liabilityAccount[0].id, processDate, principalAmount, `Principal reinvestment for deal ${deal.deal_number}`]);
  
  // Reverse accumulated interest
  if (interestPayableAccount.length > 0 && interestAccrualAccount.length > 0) {
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, ?, 0, 'LKR', ?)
    `, [deal.deal_number, interestPayableAccount[0].id, processDate, interestAmount, `Interest reversal for deal ${deal.deal_number}`]);
    
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, 0, ?, 'LKR', ?)
    `, [deal.deal_number, interestAccrualAccount[0].id, processDate, interestAmount, `Interest accrual reversal for deal ${deal.deal_number}`]);
  }
}

// Create accounting entries for lending interest receipt with principal reinvestment
async function createLendingInterestReceiptPrincipalReinvest(connection, deal, principalAmount, interestAmount, bankAccountId, processDate) {
  // Get account IDs
  const [assetAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '1%' AND name LIKE '%asset%' 
    LIMIT 1
  `);
  
  const [interestReceivedAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '8%' AND name LIKE '%interest%received%' 
    LIMIT 1
  `);
  
  const [interestReceivableAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '1%' AND name LIKE '%interest%receivable%' 
    LIMIT 1
  `);
  
  const [interestAccrualAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '8%' AND name LIKE '%interest%accrual%' 
    LIMIT 1
  `);
  
  // Interest receipt entries
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, ?, 0, 'LKR', ?)
  `, [deal.deal_number, bankAccountId, processDate, interestAmount, `Interest receipt to bank for deal ${deal.deal_number}`]);
  
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, 0, ?, 'LKR', ?)
  `, [deal.deal_number, interestReceivedAccount[0].id, processDate, interestAmount, `Interest received for deal ${deal.deal_number}`]);
  
  // Principal reinvestment entries (no bank movement, just internal transfer)
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, 0, ?, 'LKR', ?)
  `, [deal.deal_number, assetAccount[0].id, processDate, principalAmount, `Principal reinvestment for deal ${deal.deal_number}`]);
  
  // Reverse accumulated interest
  if (interestReceivableAccount.length > 0 && interestAccrualAccount.length > 0) {
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, 0, ?, 'LKR', ?)
    `, [deal.deal_number, interestAccrualAccount[0].id, processDate, interestAmount, `Interest accrual reversal for deal ${deal.deal_number}`]);
    
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, ?, 0, 'LKR', ?)
    `, [deal.deal_number, interestReceivableAccount[0].id, processDate, interestAmount, `Interest receivable reversal for deal ${deal.deal_number}`]);
  }
}

// Create accounting entries for full reinvestment
async function createFullReinvestmentEntries(connection, deal, principalAmount, interestAmount, processDate) {
  // Get account IDs
  const [liabilityAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '2%' AND name LIKE '%liability%' 
    LIMIT 1
  `);
  
  const [assetAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '1%' AND name LIKE '%asset%' 
    LIMIT 1
  `);
  
  const [interestExpenseAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '9%' AND name LIKE '%interest%expense%' 
    LIMIT 1
  `);
  
  const [interestReceivedAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '8%' AND name LIKE '%interest%received%' 
    LIMIT 1
  `);
  
  const totalAmount = principalAmount + interestAmount;
  
  if (deal.deal_direction === 'borrowing') {
    // For borrowing: Close liability, recognize interest expense, prepare for reinvestment
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, ?, 0, 'LKR', ?)
    `, [deal.deal_number, liabilityAccount[0].id, processDate, principalAmount, `Principal closure for reinvestment - deal ${deal.deal_number}`]);
    
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, ?, 0, 'LKR', ?)
    `, [deal.deal_number, interestExpenseAccount[0].id, processDate, interestAmount, `Interest expense for reinvestment - deal ${deal.deal_number}`]);
  } else if (deal.deal_direction === 'lending') {
    // For lending: Close asset, recognize interest income, prepare for reinvestment
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, 0, ?, 'LKR', ?)
    `, [deal.deal_number, assetAccount[0].id, processDate, principalAmount, `Asset closure for reinvestment - deal ${deal.deal_number}`]);
    
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, 0, ?, 'LKR', ?)
    `, [deal.deal_number, interestReceivedAccount[0].id, processDate, interestAmount, `Interest received for reinvestment - deal ${deal.deal_number}`]);
  }
}

// Create accounting entries for different amount reinvestment
async function createDifferentAmountReinvestmentEntries(connection, deal, principalAmount, interestAmount, processDate) {
  // This is similar to full reinvestment but would typically involve user-specified amounts
  // For now, we'll use the same logic as full reinvestment
  await createFullReinvestmentEntries(connection, deal, principalAmount, interestAmount, processDate);
}

// Helper function to get maturities with approval level information
async function getMaturitiesWithApprovalLevel(db, productType, date) {
  let tableName, dealIdField, dealNumberField, principalField, interestField, maturityField, counterpartyField;
  
  switch (productType) {
    case 'money_market':
      tableName = 'money_market_deals';
      dealIdField = 'mmd.id';
      dealNumberField = 'mmd.deal_number';
      principalField = 'mmd.principal_amount';
      interestField = 'mmd.interest_amount';
      maturityField = 'mmd.maturity_value';
      counterpartyField = 'COALESCE(corp.short_name, ind.short_name, joint.short_name, mmd.counterparty_id)';
      break;
    case 'gsec':
      tableName = 'gsec';
      dealIdField = 'g.id';
      dealNumberField = 'g.deal_number';
      principalField = 'g.face_value';
      interestField = 'g.accrued_interest';
      maturityField = 'g.settlement_amount';
      counterpartyField = "COALESCE(corp.short_name, ind.short_name, joint.short_name, CONCAT('ID:', g.counterparty_id))";
      break;
    case 'repo':
      tableName = 'repo_deals';
      dealIdField = 'rd.id';
      dealNumberField = 'rd.deal_number';
      principalField = 'rd.principal_amount';
      interestField = 'rd.interest_amount';
      maturityField = 'rd.maturity_amount';
      counterpartyField = 'COALESCE(corp.short_name, ind.short_name, joint.short_name, rd.counterparty_id)';
      break;
    default:
      return [];
  }

  const sql = `
    SELECT 
      ${dealIdField} as id,
      ${dealNumberField} as deal_number,
      ${principalField} as principal_amount,
      ${interestField} as interest_amount,
      ${maturityField} as maturity_value,
      ${counterpartyField} as counterparty_name,
      ${tableName === 'gsec' ? 'g.isin_number' : 'NULL'} as isin,
      ${productType === 'money_market' ? 'mmd.maturity_date' : productType === 'gsec' ? 'g.maturity_date' : 'rd.maturity_date'},
      DATEDIFF(${productType === 'money_market' ? 'mmd.maturity_date' : productType === 'gsec' ? 'g.maturity_date' : 'rd.maturity_date'}, CURDATE()) as days_to_maturity,
      ${productType === 'money_market' ? 'mmd.status' : productType === 'gsec' ? 'g.status' : 'rd.status'} as deal_status,
      COALESCE(mpl.authorization_level, 'not_initiated') as approval_level,
      CASE 
        WHEN mpl.authorization_level = 'back_office_final' THEN 'Back Office Final'
        ELSE 'Pending Final Approval'
      END as approval_level_display,
      CASE 
        WHEN mpl.authorization_level = 'back_office_final' THEN 1
        WHEN mpl.id IS NULL AND ${productType === 'money_market' ? "mmd.status = 'Approved'" : productType === 'gsec' ? "g.status = 'final_approved'" : "rd.status = 'Active'"} THEN 1
        ELSE 0
      END as is_selectable
    FROM ${tableName} ${productType === 'money_market' ? 'mmd' : productType === 'gsec' ? 'g' : 'rd'}
    ${productType === 'money_market' ? `
      LEFT JOIN counterparty_master_corporate corp ON mmd.counterparty_id = corp.id
      LEFT JOIN counterparty_master_individual ind ON mmd.counterparty_id = ind.id
      LEFT JOIN counterparty_master_joint joint ON mmd.counterparty_id = joint.id
    ` : ''}
    ${productType === 'repo' ? `
      LEFT JOIN counterparty_master_corporate corp ON rd.counterparty_id = corp.id
      LEFT JOIN counterparty_master_individual ind ON rd.counterparty_id = ind.id
      LEFT JOIN counterparty_master_joint joint ON rd.counterparty_id = joint.id
    ` : ''}
    ${productType === 'gsec' ? `
      LEFT JOIN counterparty_master_corporate corp ON
        (g.counterparty_id LIKE 'c%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = corp.id)
        OR (g.counterparty_id = corp.id)
      LEFT JOIN counterparty_master_individual ind ON
        (g.counterparty_id LIKE 'i%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = ind.id)
        OR (g.counterparty_id = ind.id)
      LEFT JOIN counterparty_master_joint joint ON
        (g.counterparty_id LIKE 'j%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = joint.id)
        OR (g.counterparty_id = joint.id)
    ` : ''}
    LEFT JOIN maturity_processing_log mpl ON ${dealIdField} = mpl.deal_id
      AND mpl.id = (
        SELECT id FROM maturity_processing_log mpl2 
        WHERE mpl2.deal_id = ${dealIdField} 
        ORDER BY mpl2.created_at DESC 
        LIMIT 1
      )
    WHERE ${productType === 'money_market' ? 'mmd.maturity_date' : productType === 'gsec' ? 'g.maturity_date' : 'rd.maturity_date'} <= ?
      AND COALESCE(${productType === 'money_market' ? 'mmd.matured' : productType === 'gsec' ? 'g.matured' : 'rd.matured'}, 0) = 0
      AND (mpl.id IS NULL OR mpl.authorization_level = 'back_office_final')
    ORDER BY ${productType === 'money_market' ? 'mmd.maturity_date' : productType === 'gsec' ? 'g.maturity_date' : 'rd.maturity_date'} ASC
  `;

  const [rows] = await db.query(sql, [date]);
  return rows;
}

// Extended handlers for maturity handling, processing, and export
MaturityController.getMaturityHandlingPeriod = async (req, res) => {
  try {
    const { dateFrom, dateTo, type } = req.query;
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ success: false, error: 'dateFrom and dateTo are required' });
    }
    const db = require('../config/database');
    const typeFilter = type && type !== 'all' ? type : null;

    const rows = [];

    // Money Market
    if (!typeFilter || typeFilter === 'money_market') {
      const [mm] = await db.query(
        `SELECT 'money_market' AS deal_type, mmd.deal_number, mmd.maturity_date,
                mmd.principal_amount AS face_value, mmd.maturity_value AS maturity_amount,
                COALESCE(corp.short_name, ind.short_name, joint.short_name, mmd.counterparty_id) AS counterparty,
                mmd.status
         FROM money_market_deals mmd
         LEFT JOIN counterparty_master_corporate corp ON mmd.counterparty_id = corp.id
         LEFT JOIN counterparty_master_individual ind ON mmd.counterparty_id = ind.id
         LEFT JOIN counterparty_master_joint joint ON mmd.counterparty_id = joint.id
         WHERE mmd.maturity_date >= ? AND mmd.maturity_date <= ?
           AND mmd.status = 'final_approved'
         ORDER BY mmd.maturity_date ASC`,
        [dateFrom, dateTo]
      );
      rows.push(...mm);
    }

    // GSec
    if (!typeFilter || typeFilter === 'gsec') {
      const [gs] = await db.query(
        `SELECT 'gsec' AS deal_type, g.deal_number, g.maturity_date,
                g.face_value, NULL AS maturity_amount,
                COALESCE(corp.short_name, ind.short_name, joint.short_name, g.counterparty_id) AS counterparty,
                g.status
         FROM gsec g
         LEFT JOIN counterparty_master_corporate corp ON
           (g.counterparty_id LIKE 'c%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = corp.id)
         LEFT JOIN counterparty_master_individual ind ON
           (g.counterparty_id LIKE 'i%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = ind.id)
         LEFT JOIN counterparty_master_joint joint ON
           (g.counterparty_id LIKE 'j%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = joint.id)
         WHERE g.maturity_date >= ? AND g.maturity_date <= ?
           AND g.transaction_type = 'Buy'
           AND g.status = 'final_approved'
         ORDER BY g.maturity_date ASC`,
        [dateFrom, dateTo]
      );
      rows.push(...gs);
    }

    // T-Bill
    if (!typeFilter || typeFilter === 'tbill') {
      const [tb] = await db.query(
        `SELECT 'tbill' AS deal_type, t.deal_number, t.maturity_date,
                t.face_value, NULL AS maturity_amount,
                COALESCE(corp.short_name, ind.short_name, joint.short_name, t.counterparty) AS counterparty,
                t.status
         FROM tbill t
         LEFT JOIN counterparty_master_corporate corp ON
           (t.counterparty LIKE 'c%' AND CAST(SUBSTRING(t.counterparty, 2) AS UNSIGNED) = corp.id)
         LEFT JOIN counterparty_master_individual ind ON
           (t.counterparty LIKE 'i%' AND CAST(SUBSTRING(t.counterparty, 2) AS UNSIGNED) = ind.id)
         LEFT JOIN counterparty_master_joint joint ON
           (t.counterparty LIKE 'j%' AND CAST(SUBSTRING(t.counterparty, 2) AS UNSIGNED) = joint.id)
         WHERE t.maturity_date >= ? AND t.maturity_date <= ?
           AND t.transaction_type = 'Buy'
           AND t.status = 'final_approved'
         ORDER BY t.maturity_date ASC`,
        [dateFrom, dateTo]
      );
      rows.push(...tb);
    }

    // Repo
    if (!typeFilter || typeFilter === 'repo') {
      const [rp] = await db.query(
        `SELECT 'repo' AS deal_type, rd.deal_number, rd.maturity_date,
                rd.face_value, rd.maturity_amount,
                COALESCE(corp.short_name, ind.short_name, joint.short_name, rd.counterparty_id) AS counterparty,
                rd.status
         FROM repo_deals rd
         LEFT JOIN counterparty_master_corporate corp ON rd.counterparty_id = corp.id
         LEFT JOIN counterparty_master_individual ind ON rd.counterparty_id = ind.id
         LEFT JOIN counterparty_master_joint joint ON rd.counterparty_id = joint.id
         WHERE rd.maturity_date >= ? AND rd.maturity_date <= ?
           AND rd.status = 'final_approved'
         ORDER BY rd.maturity_date ASC`,
        [dateFrom, dateTo]
      );
      rows.push(...rp);
    }

    // Buyback
    if (!typeFilter || typeFilter === 'buyback') {
      const [bb] = await db.query(
        `SELECT 'buyback' AS deal_type, bd.deal_number, bd.maturity_date,
                bd.leg1_face_value AS face_value, NULL AS maturity_amount,
                COALESCE(corp.short_name, ind.short_name, joint.short_name, bd.leg1_counterparty) AS counterparty,
                bd.deal_status AS status
         FROM buyback_deals bd
         LEFT JOIN counterparty_master_corporate corp ON
           (bd.leg1_counterparty LIKE 'c%' AND CAST(SUBSTRING(bd.leg1_counterparty, 2) AS UNSIGNED) = corp.id)
         LEFT JOIN counterparty_master_individual ind ON
           (bd.leg1_counterparty LIKE 'i%' AND CAST(SUBSTRING(bd.leg1_counterparty, 2) AS UNSIGNED) = ind.id)
         LEFT JOIN counterparty_master_joint joint ON
           (bd.leg1_counterparty LIKE 'j%' AND CAST(SUBSTRING(bd.leg1_counterparty, 2) AS UNSIGNED) = joint.id)
         WHERE bd.maturity_date >= ? AND bd.maturity_date <= ?
           AND bd.deal_status = 'final_approved'
         ORDER BY bd.maturity_date ASC`,
        [dateFrom, dateTo]
      );
      rows.push(...bb);
    }

    rows.sort((a, b) => {
      const da = new Date(a.maturity_date || 0);
      const db2 = new Date(b.maturity_date || 0);
      return da - db2;
    });

    return res.json({ success: true, data: rows, total: rows.length });
  } catch (error) {
    console.error('Error fetching maturity period data:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

MaturityController.getMaturityHandling = async (req, res) => {
  try {
    const { date, type, status } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, error: 'Date parameter is required' });
    }
    const selectedDate = new Date(date);
    if (isNaN(selectedDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const { getDailyMaturityCashflow } = require('../services/dailyMaturityCashflowService');
    const { rows, totals, view_mode, system_date, include_settlements, date: resolvedDate } =
      await getDailyMaturityCashflow(date, { type, status });

    return res.json({
      success: true,
      data: rows,
      totals,
      view_mode,
      system_date,
      include_settlements,
      date: resolvedDate
    });
  } catch (error) {
    console.error('Error fetching maturity handling data:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/** Full deal record for authorizer deal slip / deal ticket modal */
MaturityController.getDealTicket = async (req, res) => {
  try {
    const { productType, id } = req.params;
    if (!productType || id === undefined || id === null || id === '') {
      return res.status(400).json({ success: false, error: 'productType and id are required' });
    }

    const db = require('../config/database');
    const lookupId = Number.isFinite(Number(id)) ? Number(id) : id;
    const lookupDealNumber = String(id);

    if (productType === 'money_market') {
      const [rows] = await db.query(
        `SELECT mmd.*,
          COALESCE(corp.short_name, ind.short_name, joint.short_name, mmd.counterparty_id) AS counterparty_name
         FROM money_market_deals mmd
         LEFT JOIN counterparty_master_corporate corp ON mmd.counterparty_id = corp.id
         LEFT JOIN counterparty_master_individual ind ON mmd.counterparty_id = ind.id
         LEFT JOIN counterparty_master_joint joint ON mmd.counterparty_id = joint.id
         WHERE mmd.id = ? OR mmd.deal_number = ?
         LIMIT 1`,
        [lookupId, lookupDealNumber]
      );
      const deal = rows[0];
      if (!deal) {
        return res.status(404).json({ success: false, error: 'Money market deal not found' });
      }
      return res.json({ success: true, dealType: 'MoneyMarket', transaction: deal });
    }

    if (productType === 'gsec') {
      const [rows] = await db.query(
        `SELECT g.*,
          COALESCE(corp.short_name, ind.short_name, joint.short_name, g.counterparty_id) AS counterparty_name
         FROM gsec g
         LEFT JOIN counterparty_master_corporate corp ON
           (g.counterparty_id LIKE 'c%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = corp.id)
           OR (g.counterparty_id = corp.id)
         LEFT JOIN counterparty_master_individual ind ON
           (g.counterparty_id LIKE 'i%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = ind.id)
           OR (g.counterparty_id = ind.id)
         LEFT JOIN counterparty_master_joint joint ON
           (g.counterparty_id LIKE 'j%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = joint.id)
           OR (g.counterparty_id = joint.id)
         WHERE g.id = ? OR g.deal_number = ?
         LIMIT 1`,
        [lookupId, lookupDealNumber]
      );
      const deal = rows[0];
      if (!deal) {
        return res.status(404).json({ success: false, error: 'GSEC deal not found' });
      }
      return res.json({ success: true, dealType: 'GSec', transaction: deal });
    }

    if (productType === 'repo') {
      const RepoDeal = require('../models/repoDealModel');
      const deal = await RepoDeal.getById(lookupId);
      if (!deal) {
        return res.status(404).json({ success: false, error: 'Repo deal not found' });
      }
      return res.json({
        success: true,
        dealType: 'Repo',
        transaction: {
          ...deal,
          principal_amount: deal.principal_amount,
          maturity_value: deal.maturity_amount,
          face_value: deal.face_value || deal.principal_amount,
          collateral_face_value: deal.face_value || deal.face_value_as_per_counterparty,
          status: deal.approval_status,
          current_approval_level: deal.current_approval_level
        }
      });
    }

    if (productType === 'buyback') {
      const BuybackDeal = require('../models/buybackDealModel');
      const deal = await BuybackDeal.getById(lookupId);
      if (!deal) {
        return res.status(404).json({ success: false, error: 'Buyback deal not found' });
      }
      return res.json({ success: true, dealType: 'Buyback', transaction: deal });
    }

    return res.status(400).json({ success: false, error: `Unsupported product type: ${productType}` });
  } catch (error) {
    console.error('Error fetching maturity deal ticket:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/maturity/matured-slip-number
// Issues the next Matured Deal Slip ticket number for the current month,
// format YYYYMM-#### (e.g. 202607-0024). Atomically increments a per-month
// counter so concurrent requests never collide.
MaturityController.getMaturedSlipNumber = async (req, res) => {
  try {
    const db = require('../config/database');
    const now = new Date();
    const periodYm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    await db.query(
      `INSERT INTO matured_slip_sequence (period_ym, last_seq)
       VALUES (?, 1)
       ON DUPLICATE KEY UPDATE last_seq = last_seq + 1`,
      [periodYm]
    );
    const [rows] = await db.query(
      'SELECT last_seq FROM matured_slip_sequence WHERE period_ym = ?',
      [periodYm]
    );
    const seq = rows[0]?.last_seq || 1;
    const slipNumber = `${periodYm}-${String(seq).padStart(4, '0')}`;
    return res.json({ success: true, slipNumber });
  } catch (error) {
    console.error('Error generating matured slip number:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

MaturityController.processMaturities = async (req, res) => {
  try {
    const { dealIds, processDate, maturityAction, bankPaymentCode } = req.body || {};
    const userData = req.headers['x-user-data'];
    if (!userData) {
      return res.status(401).json({ success: false, error: 'User data not found' });
    }
    const user = JSON.parse(userData);
    const userId = user.id;

    if (!Array.isArray(dealIds) || dealIds.length === 0) {
      return res.status(400).json({ success: false, error: 'dealIds array is required' });
    }
    if (!maturityAction) {
      return res.status(400).json({ success: false, error: 'maturityAction is required' });
    }

    const db = require('../config/database');
    const connection = await db.pool.getConnection();
    await connection.beginTransaction();

    try {
      const processedDeals = [];
      for (const dealId of dealIds) {
        // Get deal details
        const [dealRows] = await connection.query(`
          SELECT mm.id, mm.deal_number, mm.principal_amount, mm.interest_rate, mm.maturity_date, mm.deal_type
          FROM money_market_deals mm WHERE mm.id = ?
          UNION ALL
          SELECT g.id, g.deal_number, g.face_value as principal_amount, g.yield as interest_rate, g.maturity_date, 'gsec' as deal_type
          FROM gsec g WHERE g.id = ?
        `, [dealId, dealId]);

        if (dealRows.length === 0) {
          throw new Error(`Deal ${dealId} not found`);
        }
        const deal = dealRows[0];
        const principalAmount = parseFloat(deal.principal_amount);
        const interestRate = parseFloat(deal.interest_rate) / 100;
        const daysToMaturity = Math.floor((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
        const interestAmount = (principalAmount * interestRate * daysToMaturity) / 365;
        const totalAmount = principalAmount + interestAmount;

        // Create initial maturity processing log entry (3-tier: start at front_office)
        await connection.query(`
          INSERT INTO maturity_processing_log
          (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount,
           processed_date, processed_by, authorization_level, bank_account_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'front_office', ?)
        `, [
          dealId,
          deal.deal_number,
          maturityAction,
          principalAmount,
          interestAmount,
          totalAmount,
          processDate,
          userId,
          null // bank_account_id will be set during approval
        ]);

        processedDeals.push({ dealId, dealNumber: deal.deal_number, maturityAction });
      }

      await connection.commit();
      return res.json({
        success: true,
        message: `Maturity processing initiated for ${processedDeals.length} deals. Awaiting Front Office Verifier approval.`,
        data: processedDeals
      });
  } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error initiating maturity processing:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Check maturity authorization with three-tier system
async function checkMaturityAuthorization(req, dealIds, maturityAction) {
  try {
    // Get user from request headers
    const userData = req.headers['x-user-data'];
    if (!userData) {
      return { authorized: false, message: 'User data not found', requiredLevel: 'back_office_final' };
    }

    const user = JSON.parse(userData);

    // Only final back office (or admin) can post maturity entries
    const isFinal = user?.role === 'back_office_final' || user?.role === 'admin';
    if (!isFinal) {
      return {
        authorized: false,
        message: 'Only Back Office Final (or Admin) can post maturity entries',
        requiredLevel: 'back_office_final'
      };
    }

    // Optionally ensure the user has access to the maturity page if provided
    if (Array.isArray(user.allowed_tabs) && !user.allowed_tabs.includes('maturity')) {
      return {
        authorized: false,
        message: 'User is not allowed to access maturity handling',
        requiredLevel: 'back_office_final'
      };
    }

    return { authorized: true };
  } catch (error) {
    console.error('Error checking maturity authorization:', error);
    return { authorized: false, message: 'Authorization check failed', requiredLevel: 'back_office_final' };
  }
}

// Get required authorization level for maturity action
function getRequiredAuthorizationLevel(maturityAction) {
  switch (maturityAction) {
    case 'principal_interest_full_payment':
      return 3; // Level 3 required; post entries only after final approval
    case 'principal_reinvest_interest_paid':
      return 2; // Level 2 required for principal reinvestment with interest payment
    case 'principal_interest_reinvest':
      return 3; // Level 3 required for full reinvestment with new terms
    case 'different_amount_reinvest':
      return 3; // Level 3 required for different amount reinvestment
    case 'partial_payment':
      return 1; // Level 1 for partial payments
    case 'rollover':
      return 2; // Level 2 for rollovers
    case 'extend':
      return 3; // Level 3 for extensions
    default:
      return 1; // Default to level 1
  }
}

// Get authorization level number
function getAuthorizationLevel(role) {
  switch (role) {
    case 'level1': return 1;
    case 'level2': return 2;
    case 'level3': return 3;
    default: return 0;
  }
}

// Calculate total maturity amount for authorization checks
async function calculateTotalMaturityAmount(dealIds) {
  const db = require('../config/db');
  let totalAmount = 0;
  
  for (const dealId of dealIds) {
    const [dealRows] = await db.query(`
      SELECT principal_amount, interest_rate, maturity_date
      FROM money_market_deals 
      WHERE id = ?
      UNION ALL
      SELECT face_value as principal_amount, yield as interest_rate, maturity_date
      FROM gsec 
      WHERE id = ?
    `, [dealId, dealId]);
    
    if (dealRows.length > 0) {
      const deal = dealRows[0];
      const principalAmount = parseFloat(deal.principal_amount);
      const interestRate = parseFloat(deal.interest_rate) / 100;
      const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
      const interestAmount = (principalAmount * interestRate * daysToMaturity) / 365;
      totalAmount += principalAmount + interestAmount;
    }
  }
  
  return totalAmount;
}

// Handle principal and interest full payment maturity action
async function handlePrincipalInterestFullPayment(dealIds, processDate, bankAccountId, res) {
  const db = require('../config/db');
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const processedDeals = [];
    
    for (const dealId of dealIds) {
      // Get deal details
      const [dealRows] = await connection.query(`
        SELECT 
          mm.id, mm.deal_number, mm.deal_type, mm.principal_amount, mm.interest_rate,
          mm.maturity_date, mm.counterparty_id, mm.isin,
          c.name as counterparty_name,
          mm.deal_direction
        FROM money_market_deals mm
        LEFT JOIN counterparties c ON mm.counterparty_id = c.id
        WHERE mm.id = ?
        UNION ALL
        SELECT 
          g.id, g.deal_number, 'gsec' as deal_type, g.face_value as principal_amount, g.yield as interest_rate,
          g.maturity_date, g.counterparty_id, g.isin,
          c.name as counterparty_name,
          g.deal_direction
        FROM gsec g
        LEFT JOIN counterparties c ON g.counterparty_id = c.id
        WHERE g.id = ?
        UNION ALL
        SELECT 
          rd.id, rd.deal_number, 'repo' as deal_type, rd.principal_amount, rd.rate as interest_rate,
          rd.maturity_date, rd.counterparty_id, rd.isin_number as isin,
          c.name as counterparty_name,
          'lending' as deal_direction
        FROM repo_deals rd
        LEFT JOIN counterparties c ON rd.counterparty_id = c.id
        WHERE rd.id = ?
      `, [dealId, dealId, dealId]);
      
      if (dealRows.length === 0) {
        throw new Error(`Deal ${dealId} not found`);
      }
      
      const deal = dealRows[0];
      const principalAmount = parseFloat(deal.principal_amount);
      const interestRate = parseFloat(deal.interest_rate) / 100;
      const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
      const interestAmount = (principalAmount * interestRate * daysToMaturity) / 365;
      const totalAmount = principalAmount + interestAmount;
      
      // Create accounting entries based on deal direction
      if (deal.deal_direction === 'borrowing') {
        // For borrowing: DR Liability Account, DR Interest Expenses, CR Bank Account
        await createBorrowingMaturityEntries(connection, deal, principalAmount, interestAmount, bankAccountId, processDate);
      } else if (deal.deal_direction === 'lending') {
        // For lending: DR Bank Account, CR Asset Account, CR Interest Received
        await createLendingMaturityEntries(connection, deal, principalAmount, interestAmount, bankAccountId, processDate);
      }
      
      // Mark deal as processed and matured on the correct table
      if (deal.deal_type === 'gsec') {
        await connection.query(`
          UPDATE gsec 
          SET matured = 1, maturity_action = 'principal_interest_full_payment'
          WHERE id = ?
        `, [dealId]);
      } else if (deal.deal_type === 'repo') {
        await connection.query(`
          UPDATE repo_deals 
          SET matured = 1, status = 'Matured', maturity_action = 'principal_interest_full_payment'
          WHERE id = ?
        `, [dealId]);
      } else {
        await connection.query(`
          UPDATE money_market_deals 
          SET matured = 1
          WHERE id = ?
        `, [dealId]);
      }
      
      // Log maturity processing for authorization tracking
      const userData = req.headers['x-user-data'];
      const user = userData ? JSON.parse(userData) : { id: null };
      
      await connection.query(`
        INSERT INTO maturity_processing_log 
        (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount, 
         processed_date, processed_by, authorization_level, bank_account_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        dealId, 
        deal.deal_number, 
        'principal_interest_full_payment',
        principalAmount, 
        interestAmount, 
        totalAmount,
        processDate,
        user.id,
        'level2',
        bankAccountId
      ]);
      
      processedDeals.push({
        dealId,
        dealNumber: deal.deal_number,
        principalAmount,
        interestAmount,
        totalAmount
      });
    }
    
    await connection.commit();
    
    return res.json({
      success: true,
      message: `Successfully processed ${processedDeals.length} deals with principal and interest full payment`,
      data: processedDeals
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error in principal interest full payment:', error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
}

// Create accounting entries for borrowing maturity
async function createBorrowingMaturityEntries(connection, deal, principalAmount, interestAmount, bankAccountId, processDate) {
  const Accounting = require('../models/accountingModel');
  
  // Get account IDs
  const [liabilityAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '2%' AND name LIKE '%liability%' 
    LIMIT 1
  `);
  
  const [interestExpenseAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '9%' AND name LIKE '%interest%expense%' 
    LIMIT 1
  `);
  
  const [interestPayableAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '2%' AND name LIKE '%interest%payable%' 
    LIMIT 1
  `);
  
  const [interestAccrualAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '8%' AND name LIKE '%interest%accrual%' 
    LIMIT 1
  `);
  
  // Main maturity entries
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, ?, 0, 'LKR', ?)
  `, [deal.deal_number, liabilityAccount[0].id, processDate, principalAmount, `Maturity - Principal payment for deal ${deal.deal_number}`]);
  
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, ?, 0, 'LKR', ?)
  `, [deal.deal_number, interestExpenseAccount[0].id, processDate, interestAmount, `Maturity - Interest expense for deal ${deal.deal_number}`]);
  
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, 0, ?, 'LKR', ?)
  `, [deal.deal_number, bankAccountId, processDate, principalAmount + interestAmount, `Maturity - Bank payment for deal ${deal.deal_number}`]);
  
  // Reverse accumulated interest
  if (interestPayableAccount.length > 0 && interestAccrualAccount.length > 0) {
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, ?, 0, 'LKR', ?)
    `, [deal.deal_number, interestPayableAccount[0].id, processDate, interestAmount, `Interest reversal for deal ${deal.deal_number}`]);
    
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, 0, ?, 'LKR', ?)
    `, [deal.deal_number, interestAccrualAccount[0].id, processDate, interestAmount, `Interest accrual reversal for deal ${deal.deal_number}`]);
  }
}

// Create accounting entries for lending maturity
async function createLendingMaturityEntries(connection, deal, principalAmount, interestAmount, bankAccountId, processDate) {
  // Get account IDs
  const [assetAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '1%' AND name LIKE '%asset%' 
    LIMIT 1
  `);
  
  const [interestReceivedAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '8%' AND name LIKE '%interest%received%' 
    LIMIT 1
  `);
  
  const [interestReceivableAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '1%' AND name LIKE '%interest%receivable%' 
    LIMIT 1
  `);
  
  const [interestAccrualAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '8%' AND name LIKE '%interest%accrual%' 
    LIMIT 1
  `);
  
  // Main maturity entries
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, ?, 0, 'LKR', ?)
  `, [deal.deal_number, bankAccountId, processDate, principalAmount + interestAmount, `Maturity - Bank receipt for deal ${deal.deal_number}`]);
  
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, 0, ?, 'LKR', ?)
  `, [deal.deal_number, assetAccount[0].id, processDate, principalAmount, `Maturity - Asset reduction for deal ${deal.deal_number}`]);
  
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, 0, ?, 'LKR', ?)
  `, [deal.deal_number, interestReceivedAccount[0].id, processDate, interestAmount, `Maturity - Interest received for deal ${deal.deal_number}`]);
  
  // Reverse accumulated interest
  if (interestReceivableAccount.length > 0 && interestAccrualAccount.length > 0) {
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, 0, ?, 'LKR', ?)
    `, [deal.deal_number, interestAccrualAccount[0].id, processDate, interestAmount, `Interest accrual reversal for deal ${deal.deal_number}`]);
    
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, ?, 0, 'LKR', ?)
    `, [deal.deal_number, interestReceivableAccount[0].id, processDate, interestAmount, `Interest receivable reversal for deal ${deal.deal_number}`]);
  }
}

// Handle principal reinvestment with interest payment
async function handlePrincipalReinvestInterestPaid(dealIds, processDate, bankAccountId, res) {
  const db = require('../config/db');
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const processedDeals = [];
    
    for (const dealId of dealIds) {
      // Get deal details
      const [dealRows] = await connection.query(`
        SELECT 
          mm.id, mm.deal_number, mm.deal_type, mm.principal_amount, mm.interest_rate,
          mm.maturity_date, mm.counterparty_id, mm.isin,
          c.name as counterparty_name,
          mm.deal_direction
        FROM money_market_deals mm
        LEFT JOIN counterparties c ON mm.counterparty_id = c.id
        WHERE mm.id = ?
        UNION ALL
        SELECT 
          g.id, g.deal_number, 'gsec' as deal_type, g.face_value as principal_amount, g.yield as interest_rate,
          g.maturity_date, g.counterparty_id, g.isin,
          c.name as counterparty_name,
          g.deal_direction
        FROM gsec g
        LEFT JOIN counterparties c ON g.counterparty_id = c.id
        WHERE g.id = ?
        UNION ALL
        SELECT 
          rd.id, rd.deal_number, 'repo' as deal_type, rd.principal_amount, rd.rate as interest_rate,
          rd.maturity_date, rd.counterparty_id, rd.isin_number as isin,
          c.name as counterparty_name,
          'lending' as deal_direction
        FROM repo_deals rd
        LEFT JOIN counterparties c ON rd.counterparty_id = c.id
        WHERE rd.id = ?
      `, [dealId, dealId, dealId]);
      
      if (dealRows.length === 0) {
        throw new Error(`Deal ${dealId} not found`);
      }
      
      const deal = dealRows[0];
      const principalAmount = parseFloat(deal.principal_amount);
      const interestRate = parseFloat(deal.interest_rate) / 100;
      const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
      const interestAmount = (principalAmount * interestRate * daysToMaturity) / 365;
      
      // Create accounting entries for principal reinvestment with interest payment
      if (deal.deal_direction === 'borrowing') {
        // For borrowing: Pay interest, reinvest principal
        await createBorrowingInterestPaymentPrincipalReinvest(connection, deal, principalAmount, interestAmount, bankAccountId, processDate);
      } else if (deal.deal_direction === 'lending') {
        // For lending: Receive interest, reinvest principal
        await createLendingInterestReceiptPrincipalReinvest(connection, deal, principalAmount, interestAmount, bankAccountId, processDate);
      }
      
      // Mark deal as processed and matured on the correct table
      if (deal.deal_type === 'gsec') {
        await connection.query(`
          UPDATE gsec 
          SET matured = 1, maturity_action = 'principal_reinvest_interest_paid'
          WHERE id = ?
        `, [dealId]);
      } else if (deal.deal_type === 'repo') {
        await connection.query(`
          UPDATE repo_deals 
          SET matured = 1, status = 'Matured', maturity_action = 'principal_reinvest_interest_paid'
          WHERE id = ?
        `, [dealId]);
      } else {
        await connection.query(`
          UPDATE money_market_deals 
          SET matured = 1
          WHERE id = ?
        `, [dealId]);
      }
      
      // Log processing
      const userData = req.headers['x-user-data'];
      const user = userData ? JSON.parse(userData) : { id: null };
      
      await connection.query(`
        INSERT INTO maturity_processing_log 
        (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount, 
         processed_date, processed_by, authorization_level, bank_account_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        dealId, 
        deal.deal_number, 
        'principal_reinvest_interest_paid',
        principalAmount, 
        interestAmount, 
        interestAmount, // Only interest is paid/received
        processDate,
        user.id,
        'level2',
        bankAccountId
      ]);
      
      processedDeals.push({
        dealId,
        dealNumber: deal.deal_number,
        principalAmount,
        interestAmount,
        reinvestmentAmount: principalAmount
      });
    }
    
    await connection.commit();
    
    return res.json({
      success: true,
      message: `Successfully processed ${processedDeals.length} deals with principal reinvestment and interest payment`,
      data: processedDeals
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error in principal reinvest interest paid:', error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
}

// Handle full principal and interest reinvestment
async function handlePrincipalInterestReinvest(dealIds, processDate, res) {
  const db = require('../config/db');
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const processedDeals = [];
    
    for (const dealId of dealIds) {
      // Get deal details
      const [dealRows] = await connection.query(`
        SELECT 
          mm.id, mm.deal_number, mm.deal_type, mm.principal_amount, mm.interest_rate,
          mm.maturity_date, mm.counterparty_id, mm.isin,
          c.name as counterparty_name,
          mm.deal_direction
        FROM money_market_deals mm
        LEFT JOIN counterparties c ON mm.counterparty_id = c.id
        WHERE mm.id = ?
        UNION ALL
        SELECT 
          g.id, g.deal_number, 'gsec' as deal_type, g.face_value as principal_amount, g.yield as interest_rate,
          g.maturity_date, g.counterparty_id, g.isin,
          c.name as counterparty_name,
          g.deal_direction
        FROM gsec g
        LEFT JOIN counterparties c ON g.counterparty_id = c.id
        WHERE g.id = ?
        UNION ALL
        SELECT 
          rd.id, rd.deal_number, 'repo' as deal_type, rd.principal_amount, rd.rate as interest_rate,
          rd.maturity_date, rd.counterparty_id, rd.isin_number as isin,
          c.name as counterparty_name,
          'lending' as deal_direction
        FROM repo_deals rd
        LEFT JOIN counterparties c ON rd.counterparty_id = c.id
        WHERE rd.id = ?
      `, [dealId, dealId, dealId]);
      
      if (dealRows.length === 0) {
        throw new Error(`Deal ${dealId} not found`);
      }
      
      const deal = dealRows[0];
      const principalAmount = parseFloat(deal.principal_amount);
      const interestRate = parseFloat(deal.interest_rate) / 100;
      const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
      const interestAmount = (principalAmount * interestRate * daysToMaturity) / 365;
      const totalReinvestmentAmount = principalAmount + interestAmount;
      
      // Create accounting entries for full reinvestment
      await createFullReinvestmentEntries(connection, deal, principalAmount, interestAmount, processDate);
      
      // Mark deal as processed and matured on the correct table
      if (deal.deal_type === 'gsec') {
        await connection.query(`
          UPDATE gsec 
          SET matured = 1, maturity_action = 'principal_interest_reinvest'
          WHERE id = ?
        `, [dealId]);
      } else if (deal.deal_type === 'repo') {
        await connection.query(`
          UPDATE repo_deals 
          SET matured = 1, status = 'Matured', maturity_action = 'principal_interest_reinvest'
          WHERE id = ?
        `, [dealId]);
      } else {
        await connection.query(`
          UPDATE money_market_deals 
          SET matured = 1
          WHERE id = ?
        `, [dealId]);
      }
      
      // Log processing
      const userData = req.headers['x-user-data'];
      const user = userData ? JSON.parse(userData) : { id: null };
      
      await connection.query(`
        INSERT INTO maturity_processing_log 
        (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount, 
         processed_date, processed_by, authorization_level, bank_account_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        dealId, 
        deal.deal_number, 
        'principal_interest_reinvest',
        principalAmount, 
        interestAmount, 
        totalReinvestmentAmount,
        processDate,
        user.id,
        'level3',
        null
      ]);
      
      processedDeals.push({
        dealId,
        dealNumber: deal.deal_number,
        principalAmount,
        interestAmount,
        totalReinvestmentAmount
      });
    }
    
    await connection.commit();
    
    return res.json({
      success: true,
      message: `Successfully processed ${processedDeals.length} deals with full principal and interest reinvestment`,
      data: processedDeals
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error in principal interest reinvest:', error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
}

// Handle different amount reinvestment
async function handleDifferentAmountReinvest(dealIds, processDate, res) {
  const db = require('../config/db');
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const processedDeals = [];
    
    for (const dealId of dealIds) {
      // Get deal details
      const [dealRows] = await connection.query(`
        SELECT 
          mm.id, mm.deal_number, mm.deal_type, mm.principal_amount, mm.interest_rate,
          mm.maturity_date, mm.counterparty_id, mm.isin,
          c.name as counterparty_name,
          mm.deal_direction
        FROM money_market_deals mm
        LEFT JOIN counterparties c ON mm.counterparty_id = c.id
        WHERE mm.id = ?
        UNION ALL
        SELECT 
          g.id, g.deal_number, 'gsec' as deal_type, g.face_value as principal_amount, g.yield as interest_rate,
          g.maturity_date, g.counterparty_id, g.isin,
          c.name as counterparty_name,
          g.deal_direction
        FROM gsec g
        LEFT JOIN counterparties c ON g.counterparty_id = c.id
        WHERE g.id = ?
        UNION ALL
        SELECT 
          rd.id, rd.deal_number, 'repo' as deal_type, rd.principal_amount, rd.rate as interest_rate,
          rd.maturity_date, rd.counterparty_id, rd.isin_number as isin,
          c.name as counterparty_name,
          'lending' as deal_direction
        FROM repo_deals rd
        LEFT JOIN counterparties c ON rd.counterparty_id = c.id
        WHERE rd.id = ?
      `, [dealId, dealId, dealId]);
      
      if (dealRows.length === 0) {
        throw new Error(`Deal ${dealId} not found`);
      }
      
      const deal = dealRows[0];
      const principalAmount = parseFloat(deal.principal_amount);
      const interestRate = parseFloat(deal.interest_rate) / 100;
      const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
      const interestAmount = (principalAmount * interestRate * daysToMaturity) / 365;
      
      // For different amount reinvestment, we need additional parameters
      // This would typically require user input for the new amount
      // For now, we'll process as a standard reinvestment
      await createDifferentAmountReinvestmentEntries(connection, deal, principalAmount, interestAmount, processDate);
      
      // Mark deal as processed and matured on the correct table
      if (deal.deal_type === 'gsec') {
        await connection.query(`
          UPDATE gsec 
          SET matured = 1, maturity_action = 'different_amount_reinvest'
          WHERE id = ?
        `, [dealId]);
      } else if (deal.deal_type === 'repo') {
        await connection.query(`
          UPDATE repo_deals 
          SET matured = 1, status = 'Matured', maturity_action = 'different_amount_reinvest'
          WHERE id = ?
        `, [dealId]);
      } else {
        await connection.query(`
          UPDATE money_market_deals 
          SET matured = 1
          WHERE id = ?
        `, [dealId]);
      }
      
      // Log processing
      const userData = req.headers['x-user-data'];
      const user = userData ? JSON.parse(userData) : { id: null };
      
      await connection.query(`
        INSERT INTO maturity_processing_log 
        (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount, 
         processed_date, processed_by, authorization_level, bank_account_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        dealId, 
        deal.deal_number, 
        'different_amount_reinvest',
        principalAmount, 
        interestAmount, 
        principalAmount + interestAmount, // This would be the new amount
        processDate,
        user.id,
        'level3',
        null
      ]);
      
      processedDeals.push({
        dealId,
        dealNumber: deal.deal_number,
        originalAmount: principalAmount + interestAmount,
        reinvestmentAmount: principalAmount + interestAmount, // This would be user-specified
        note: 'Different amount reinvestment - requires manual deal creation'
      });
    }
    
    await connection.commit();
    
    return res.json({
      success: true,
      message: `Successfully processed ${processedDeals.length} deals for different amount reinvestment`,
      data: processedDeals
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error in different amount reinvest:', error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
}

MaturityController.getBankAccounts = async (req, res) => {
  try {
    const db = require('../config/database');
    
    // Get bank accounts from chart of accounts
    const [bankAccounts] = await db.query(`
      SELECT id, account_code, name, account_type_id
      FROM chart_of_accounts 
      WHERE account_code LIKE '1%' 
        AND (name LIKE '%bank%' OR name LIKE '%cash%')
        AND is_active = TRUE
      ORDER BY account_code
    `);
    
    return res.json({
      success: true,
      data: bankAccounts,
      message: `Found ${bankAccounts.length} bank accounts`
    });
  } catch (error) {
    console.error('Error fetching bank accounts:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

MaturityController.getMaturityProcessingHistory = async (req, res) => {
  try {
    const db = require('../config/database');
    const { startDate, endDate, userId, authorizationLevel } = req.query;
    
    let query = `
      SELECT mpl.*, u.username as processed_by_name
      FROM maturity_processing_log mpl
      LEFT JOIN users u ON mpl.processed_by = u.id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (startDate) {
      query += ` AND mpl.processed_date >= ?`;
      params.push(startDate);
    }
    
    if (endDate) {
      query += ` AND mpl.processed_date <= ?`;
      params.push(endDate);
    }
    
    if (userId) {
      query += ` AND mpl.processed_by = ?`;
      params.push(userId);
    }
    
    if (authorizationLevel) {
      query += ` AND mpl.authorization_level = ?`;
      params.push(authorizationLevel);
    }
    
    query += ` ORDER BY mpl.processed_date DESC, mpl.created_at DESC`;
    
    const [history] = await db.query(query, params);
    
    return res.json({
      success: true,
      data: history,
      message: `Found ${history.length} maturity processing records`
    });
  } catch (error) {
    console.error('Error fetching maturity processing history:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

MaturityController.exportMaturities = async (req, res) => {
  try {
    const { date, type, status, format = 'excel' } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, error: 'Date parameter is required' });
    }
    const selectedDate = new Date(date);
    if (isNaN(selectedDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const { getDailyMaturityCashflow } = require('../services/dailyMaturityCashflowService');
    const { rows, totals } = await getDailyMaturityCashflow(date, { type, status });

    // Export the same columns/values shown on Maturity Handling (not GSec report columns).
    const exporter = require('../utils/reportExporter');
    const buf = await exporter.exportDailyMaturityCashflow(format, rows || [], totals || {});
    const mime = exporter.getMimeType(format);
    res.setHeader('Content-Type', mime);
    const dateStr = String(date);
    res.setHeader('Content-Disposition', `attachment; filename="daily-maturity-cashflow-${dateStr}.${format === 'excel' ? 'xlsx' : format === 'csv' ? 'csv' : 'pdf'}"`);
    return res.status(200).send(buf);
  } catch (error) {
    console.error('Error exporting maturities:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ==================== Pre-Approval Endpoints ====================

/**
 * Get deals available for pre-approval (final approved deals)
 */
MaturityController.getPreApprovalDeals = async (req, res) => {
  try {
    const { productType, dateRange, counterparty, status } = req.query;
    const db = require('../config/database');
    
    let deals = [];
    
    // Get GSEC deals - final approved, Buy type, not matured
    if (!productType || productType === 'all' || productType === 'gsec') {
      let gsecQuery = `
        SELECT 
          g.id,
          g.deal_number,
          g.isin,
          g.counterparty,
          COALESCE(
            corp.short_name,
            ind.short_name,
            joint.short_name,
            g.counterparty
          ) as counterparty_name,
          g.face_value,
          g.maturity_date,
          g.status,
          DATEDIFF(g.maturity_date, CURDATE()) as days_to_maturity,
          'gsec' as product_type,
          COALESCE(g.pre_approved, 0) as pre_approved,
          g.pre_approval_status
        FROM gsec g
        LEFT JOIN counterparty_master_corporate corp ON 
          (g.counterparty LIKE 'c%' AND SUBSTRING(g.counterparty, 2) = corp.id)
        LEFT JOIN counterparty_master_individual ind ON 
          (g.counterparty LIKE 'i%' AND SUBSTRING(g.counterparty, 2) = ind.id)
        LEFT JOIN counterparty_master_joint joint ON 
          (g.counterparty LIKE 'j%' AND SUBSTRING(g.counterparty, 2) = joint.id)
        WHERE g.status = 'final_approved'
          AND g.transaction_type = 'Buy'
          AND COALESCE(g.matured, 0) = 0
      `;
      
      const params = [];
      if (dateRange) {
        const [startDate, endDate] = dateRange.split(',');
        if (startDate) {
          gsecQuery += ` AND g.maturity_date >= ?`;
          params.push(startDate);
        }
        if (endDate) {
          gsecQuery += ` AND g.maturity_date <= ?`;
          params.push(endDate);
        }
      }
      if (counterparty) {
        gsecQuery += ` AND (g.counterparty LIKE ? OR corp.short_name LIKE ? OR ind.short_name LIKE ? OR joint.short_name LIKE ?)`;
        const cpPattern = `%${counterparty}%`;
        params.push(cpPattern, cpPattern, cpPattern, cpPattern);
      }
      if (status && status !== 'all') {
        if (status === 'not_pre_approved') {
          gsecQuery += ` AND COALESCE(g.pre_approved, 0) = 0`;
        } else {
          gsecQuery += ` AND g.pre_approval_status = ?`;
          params.push(status);
        }
      }
      
      gsecQuery += ` ORDER BY g.maturity_date ASC`;
      const [gsecRows] = await db.query(gsecQuery, params);
      deals = deals.concat(gsecRows.map(row => ({ ...row, product_type: 'gsec' })));
    }
    
    // Get Money Market deals - Approved, not matured
    if (!productType || productType === 'all' || productType === 'money_market') {
      let mmQuery = `
        SELECT 
          mmd.id,
          mmd.deal_number,
          NULL as isin,
          mmd.counterparty_id as counterparty,
          COALESCE(
            corp.short_name,
            ind.short_name,
            joint.short_name,
            mmd.counterparty_id
          ) as counterparty_name,
          mmd.principal_amount as face_value,
          mmd.maturity_date,
          mmd.status,
          DATEDIFF(mmd.maturity_date, CURDATE()) as days_to_maturity,
          'money_market' as product_type,
          COALESCE(mmd.pre_approved, 0) as pre_approved,
          mmd.pre_approval_status
        FROM money_market_deals mmd
        LEFT JOIN counterparty_master_corporate corp ON mmd.counterparty_id = corp.id
        LEFT JOIN counterparty_master_individual ind ON mmd.counterparty_id = ind.id
        LEFT JOIN counterparty_master_joint joint ON mmd.counterparty_id = joint.id
        WHERE mmd.status = 'Approved'
          AND COALESCE(mmd.matured, 0) = 0
      `;
      
      const params = [];
      if (dateRange) {
        const [startDate, endDate] = dateRange.split(',');
        if (startDate) {
          mmQuery += ` AND mmd.maturity_date >= ?`;
          params.push(startDate);
        }
        if (endDate) {
          mmQuery += ` AND mmd.maturity_date <= ?`;
          params.push(endDate);
        }
      }
      if (counterparty) {
        mmQuery += ` AND (mmd.counterparty_id LIKE ? OR corp.short_name LIKE ? OR ind.short_name LIKE ? OR joint.short_name LIKE ?)`;
        const cpPattern = `%${counterparty}%`;
        params.push(cpPattern, cpPattern, cpPattern, cpPattern);
      }
      if (status && status !== 'all') {
        if (status === 'not_pre_approved') {
          mmQuery += ` AND COALESCE(mmd.pre_approved, 0) = 0`;
        } else {
          mmQuery += ` AND mmd.pre_approval_status = ?`;
          params.push(status);
        }
      }
      
      mmQuery += ` ORDER BY mmd.maturity_date ASC`;
      const [mmRows] = await db.query(mmQuery, params);
      deals = deals.concat(mmRows.map(row => ({ ...row, product_type: 'money_market' })));
    }
    
    // Get Fixed Deposit deals - Approved, final_approved level
    if (!productType || productType === 'all' || productType === 'fixed_deposit') {
      let fdQuery = `
        SELECT 
          fdr.id,
          fdr.request_no as deal_number,
          NULL as isin,
          fdr.counterparty_id as counterparty,
          COALESCE(
            corp.short_name,
            ind.short_name,
            joint.short_name,
            fdr.counterparty_id
          ) as counterparty_name,
          fdr.requested_amount as face_value,
          fdr.maturity_date,
          fdr.status,
          DATEDIFF(fdr.maturity_date, CURDATE()) as days_to_maturity,
          'fixed_deposit' as product_type,
          COALESCE(fdr.pre_approved, 0) as pre_approved,
          fdr.pre_approval_status
        FROM fixed_deposit_requests fdr
        LEFT JOIN counterparty_master_corporate corp ON fdr.counterparty_id = corp.id
        LEFT JOIN counterparty_master_individual ind ON fdr.counterparty_id = ind.id
        LEFT JOIN counterparty_master_joint joint ON fdr.counterparty_id = joint.id
        WHERE fdr.status = 'Approved'
          AND fdr.current_approval_level = 'final_approved'
      `;
      
      const params = [];
      if (dateRange) {
        const [startDate, endDate] = dateRange.split(',');
        if (startDate) {
          fdQuery += ` AND fdr.maturity_date >= ?`;
          params.push(startDate);
        }
        if (endDate) {
          fdQuery += ` AND fdr.maturity_date <= ?`;
          params.push(endDate);
        }
      }
      if (counterparty) {
        fdQuery += ` AND (fdr.counterparty_id LIKE ? OR corp.short_name LIKE ? OR ind.short_name LIKE ? OR joint.short_name LIKE ?)`;
        const cpPattern = `%${counterparty}%`;
        params.push(cpPattern, cpPattern, cpPattern, cpPattern);
      }
      if (status && status !== 'all') {
        if (status === 'not_pre_approved') {
          fdQuery += ` AND COALESCE(fdr.pre_approved, 0) = 0`;
        } else {
          fdQuery += ` AND fdr.pre_approval_status = ?`;
          params.push(status);
        }
      }
      
      fdQuery += ` ORDER BY fdr.maturity_date ASC`;
      const [fdRows] = await db.query(fdQuery, params);
      deals = deals.concat(fdRows.map(row => ({ ...row, product_type: 'fixed_deposit' })));
    }
    
    res.json({
      success: true,
      data: deals,
      message: `Found ${deals.length} deals available for pre-approval`
    });
  } catch (error) {
    console.error('Error fetching pre-approval deals:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch pre-approval deals: ' + error.message
    });
  }
};

/**
 * Pre-approve a deal - mark as pre-approved and elevate to authorizer
 */
MaturityController.preApproveDeal = async (req, res) => {
  try {
    const { productType, dealId } = req.params;
    const db = require('../config/database');
    
    if (!productType || !dealId) {
      return res.status(400).json({
        success: false,
        error: 'productType and dealId are required'
      });
    }
    
    const user = req.headers['x-user-data'] ? JSON.parse(req.headers['x-user-data']) : null;
    const userId = user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User authentication required'
      });
    }
    
    let tableName;
    let dealNumberField;
    
    switch (productType) {
      case 'gsec':
        tableName = 'gsec';
        dealNumberField = 'deal_number';
        break;
      case 'money_market':
        tableName = 'money_market_deals';
        dealNumberField = 'deal_number';
        break;
      case 'fixed_deposit':
        tableName = 'fixed_deposit_requests';
        dealNumberField = 'request_no';
        break;
      case 'repo':
        tableName = 'repo_deals';
        dealNumberField = 'id';
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid product type'
        });
    }
    
    // Update deal with pre-approval status
    const [result] = await db.query(`
      UPDATE ${tableName}
      SET pre_approved = 1,
          pre_approved_by = ?,
          pre_approved_at = NOW(),
          pre_approval_status = 'pre_approved_pending',
          current_approval_level = 'back_office_final'
      WHERE id = ?
    `, [userId, dealId]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Deal not found or cannot be pre-approved'
      });
    }
    
    // Get deal number for response
    const [dealRows] = await db.query(`
      SELECT ${dealNumberField} as deal_number FROM ${tableName} WHERE id = ?
    `, [dealId]);
    
    res.json({
      success: true,
      message: `Deal ${dealRows[0]?.deal_number || dealId} has been pre-approved and elevated to authorizer`,
      data: {
        dealId,
        dealNumber: dealRows[0]?.deal_number || dealId,
        productType,
        preApprovalStatus: 'pre_approved_pending'
      }
    });
  } catch (error) {
    console.error('Error pre-approving deal:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to pre-approve deal: ' + error.message
    });
  }
};

/**
 * Authorizer approves pre-approval
 */
MaturityController.approvePreApproval = async (req, res) => {
  try {
    const { productType, dealId } = req.params;
    const db = require('../config/database');
    
    if (!productType || !dealId) {
      return res.status(400).json({
        success: false,
        error: 'productType and dealId are required'
      });
    }
    
    const user = req.headers['x-user-data'] ? JSON.parse(req.headers['x-user-data']) : null;
    const userId = user?.id;
    const userRole = user?.role;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User authentication required'
      });
    }
    
    // Check if user has authorization role
    if (userRole !== 'back_office_final' && userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Only authorizers can approve pre-approvals'
      });
    }
    
    let tableName;
    let dealNumberField;
    
    switch (productType) {
      case 'gsec':
        tableName = 'gsec';
        dealNumberField = 'deal_number';
        break;
      case 'money_market':
        tableName = 'money_market_deals';
        dealNumberField = 'deal_number';
        break;
      case 'fixed_deposit':
        tableName = 'fixed_deposit_requests';
        dealNumberField = 'request_no';
        break;
      case 'repo':
        tableName = 'repo_deals';
        dealNumberField = 'id';
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid product type'
        });
    }
    
    // Update deal with approved pre-approval status
    const [result] = await db.query(`
      UPDATE ${tableName}
      SET pre_approval_status = 'pre_approved',
          pre_approval_authorized_by = ?,
          pre_approval_authorized_at = NOW()
      WHERE id = ?
        AND pre_approval_status = 'pre_approved_pending'
    `, [userId, dealId]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Deal not found or pre-approval is not pending'
      });
    }
    
    // Get deal number for response
    const [dealRows] = await db.query(`
      SELECT ${dealNumberField} as deal_number FROM ${tableName} WHERE id = ?
    `, [dealId]);
    
    res.json({
      success: true,
      message: `Pre-approval for deal ${dealRows[0]?.deal_number || dealId} has been approved`,
      data: {
        dealId,
        dealNumber: dealRows[0]?.deal_number || dealId,
        productType,
        preApprovalStatus: 'pre_approved'
      }
    });
  } catch (error) {
    console.error('Error approving pre-approval:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve pre-approval: ' + error.message
    });
  }
};

/**
 * Authorizer rejects pre-approval
 */
MaturityController.rejectPreApproval = async (req, res) => {
  try {
    const { productType, dealId } = req.params;
    const db = require('../config/database');
    
    if (!productType || !dealId) {
      return res.status(400).json({
        success: false,
        error: 'productType and dealId are required'
      });
    }
    
    const user = req.headers['x-user-data'] ? JSON.parse(req.headers['x-user-data']) : null;
    const userId = user?.id;
    const userRole = user?.role;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User authentication required'
      });
    }
    
    // Check if user has authorization role
    if (userRole !== 'back_office_final' && userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Only authorizers can reject pre-approvals'
      });
    }
    
    let tableName;
    let dealNumberField;
    
    switch (productType) {
      case 'gsec':
        tableName = 'gsec';
        dealNumberField = 'deal_number';
        break;
      case 'money_market':
        tableName = 'money_market_deals';
        dealNumberField = 'deal_number';
        break;
      case 'fixed_deposit':
        tableName = 'fixed_deposit_requests';
        dealNumberField = 'request_no';
        break;
      case 'repo':
        tableName = 'repo_deals';
        dealNumberField = 'id';
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid product type'
        });
    }
    
    // Update deal - reject pre-approval and reset
    const [result] = await db.query(`
      UPDATE ${tableName}
      SET pre_approved = 0,
          pre_approval_status = 'rejected',
          pre_approval_authorized_by = ?,
          pre_approval_authorized_at = NOW()
      WHERE id = ?
        AND pre_approval_status = 'pre_approved_pending'
    `, [userId, dealId]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Deal not found or pre-approval is not pending'
      });
    }
    
    // Get deal number for response
    const [dealRows] = await db.query(`
      SELECT ${dealNumberField} as deal_number FROM ${tableName} WHERE id = ?
    `, [dealId]);
    
    res.json({
      success: true,
      message: `Pre-approval for deal ${dealRows[0]?.deal_number || dealId} has been rejected`,
      data: {
        dealId,
        dealNumber: dealRows[0]?.deal_number || dealId,
        productType,
        preApprovalStatus: 'rejected'
      }
    });
  } catch (error) {
    console.error('Error rejecting pre-approval:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reject pre-approval: ' + error.message
    });
  }
};

/**
 * Get pre-approved deals for blotter (status = 'pre_approved')
 */
MaturityController.getPreApprovedDeals = async (req, res) => {
  try {
    const { productType, dateRange, counterparty, status } = req.query;
    const db = require('../config/database');
    
    let deals = [];
    
    // Get GSEC deals - pre_approved status
    if (!productType || productType === 'all' || productType === 'gsec') {
      let gsecQuery = `
        SELECT 
          g.id,
          g.deal_number,
          g.isin,
          g.counterparty,
          COALESCE(
            corp.short_name,
            ind.short_name,
            joint.short_name,
            g.counterparty
          ) as counterparty_name,
          g.face_value,
          g.maturity_date,
          g.status,
          DATEDIFF(g.maturity_date, CURDATE()) as days_to_maturity,
          'gsec' as product_type,
          g.pre_approved,
          g.pre_approval_status,
          g.pre_approved_at,
          g.pre_approval_authorized_at
        FROM gsec g
        LEFT JOIN counterparty_master_corporate corp ON 
          (g.counterparty LIKE 'c%' AND SUBSTRING(g.counterparty, 2) = corp.id)
        LEFT JOIN counterparty_master_individual ind ON 
          (g.counterparty LIKE 'i%' AND SUBSTRING(g.counterparty, 2) = ind.id)
        LEFT JOIN counterparty_master_joint joint ON 
          (g.counterparty LIKE 'j%' AND SUBSTRING(g.counterparty, 2) = joint.id)
        WHERE g.pre_approval_status = 'pre_approved'
      `;
      
      const params = [];
      if (dateRange) {
        const [startDate, endDate] = dateRange.split(',');
        if (startDate) {
          gsecQuery += ` AND g.maturity_date >= ?`;
          params.push(startDate);
        }
        if (endDate) {
          gsecQuery += ` AND g.maturity_date <= ?`;
          params.push(endDate);
        }
      }
      if (counterparty) {
        gsecQuery += ` AND (g.counterparty LIKE ? OR corp.short_name LIKE ? OR ind.short_name LIKE ? OR joint.short_name LIKE ?)`;
        const cpPattern = `%${counterparty}%`;
        params.push(cpPattern, cpPattern, cpPattern, cpPattern);
      }
      
      gsecQuery += ` ORDER BY g.maturity_date ASC`;
      const [gsecRows] = await db.query(gsecQuery, params);
      deals = deals.concat(gsecRows.map(row => ({ ...row, product_type: 'gsec' })));
    }
    
    // Get Money Market deals - pre_approved status
    if (!productType || productType === 'all' || productType === 'money_market') {
      let mmQuery = `
        SELECT 
          mmd.id,
          mmd.deal_number,
          NULL as isin,
          mmd.counterparty_id as counterparty,
          COALESCE(
            corp.short_name,
            ind.short_name,
            joint.short_name,
            mmd.counterparty_id
          ) as counterparty_name,
          mmd.principal_amount as face_value,
          mmd.maturity_date,
          mmd.status,
          DATEDIFF(mmd.maturity_date, CURDATE()) as days_to_maturity,
          'money_market' as product_type,
          mmd.pre_approved,
          mmd.pre_approval_status,
          mmd.pre_approved_at,
          mmd.pre_approval_authorized_at
        FROM money_market_deals mmd
        LEFT JOIN counterparty_master_corporate corp ON mmd.counterparty_id = corp.id
        LEFT JOIN counterparty_master_individual ind ON mmd.counterparty_id = ind.id
        LEFT JOIN counterparty_master_joint joint ON mmd.counterparty_id = joint.id
        WHERE mmd.pre_approval_status = 'pre_approved'
      `;
      
      const params = [];
      if (dateRange) {
        const [startDate, endDate] = dateRange.split(',');
        if (startDate) {
          mmQuery += ` AND mmd.maturity_date >= ?`;
          params.push(startDate);
        }
        if (endDate) {
          mmQuery += ` AND mmd.maturity_date <= ?`;
          params.push(endDate);
        }
      }
      if (counterparty) {
        mmQuery += ` AND (mmd.counterparty_id LIKE ? OR corp.short_name LIKE ? OR ind.short_name LIKE ? OR joint.short_name LIKE ?)`;
        const cpPattern = `%${counterparty}%`;
        params.push(cpPattern, cpPattern, cpPattern, cpPattern);
      }
      
      mmQuery += ` ORDER BY mmd.maturity_date ASC`;
      const [mmRows] = await db.query(mmQuery, params);
      deals = deals.concat(mmRows.map(row => ({ ...row, product_type: 'money_market' })));
    }
    
    // Get Fixed Deposit deals - pre_approved status
    if (!productType || productType === 'all' || productType === 'fixed_deposit') {
      let fdQuery = `
        SELECT 
          fdr.id,
          fdr.request_no as deal_number,
          NULL as isin,
          fdr.counterparty_id as counterparty,
          COALESCE(
            corp.short_name,
            ind.short_name,
            joint.short_name,
            fdr.counterparty_id
          ) as counterparty_name,
          fdr.requested_amount as face_value,
          fdr.maturity_date,
          fdr.status,
          DATEDIFF(fdr.maturity_date, CURDATE()) as days_to_maturity,
          'fixed_deposit' as product_type,
          fdr.pre_approved,
          fdr.pre_approval_status,
          fdr.pre_approved_at,
          fdr.pre_approval_authorized_at
        FROM fixed_deposit_requests fdr
        LEFT JOIN counterparty_master_corporate corp ON fdr.counterparty_id = corp.id
        LEFT JOIN counterparty_master_individual ind ON fdr.counterparty_id = ind.id
        LEFT JOIN counterparty_master_joint joint ON fdr.counterparty_id = joint.id
        WHERE fdr.pre_approval_status = 'pre_approved'
      `;
      
      const params = [];
      if (dateRange) {
        const [startDate, endDate] = dateRange.split(',');
        if (startDate) {
          fdQuery += ` AND fdr.maturity_date >= ?`;
          params.push(startDate);
        }
        if (endDate) {
          fdQuery += ` AND fdr.maturity_date <= ?`;
          params.push(endDate);
        }
      }
      if (counterparty) {
        fdQuery += ` AND (fdr.counterparty_id LIKE ? OR corp.short_name LIKE ? OR ind.short_name LIKE ? OR joint.short_name LIKE ?)`;
        const cpPattern = `%${counterparty}%`;
        params.push(cpPattern, cpPattern, cpPattern, cpPattern);
      }
      
      fdQuery += ` ORDER BY fdr.maturity_date ASC`;
      const [fdRows] = await db.query(fdQuery, params);
      deals = deals.concat(fdRows.map(row => ({ ...row, product_type: 'fixed_deposit' })));
    }
    
    res.json({
      success: true,
      data: deals,
      message: `Found ${deals.length} pre-approved deals`
    });
  } catch (error) {
    console.error('Error fetching pre-approved deals:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch pre-approved deals: ' + error.message
    });
  }
};

module.exports = MaturityController;
 
// --- Maturity Blotter helpers (3-tier flow like GSEC) ---
// List pending maturities for blotters by role
MaturityController.getMaturityBlotter = async (req, res) => {
  try {
    const db = require('../config/database');
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().slice(0, 10);

    // Determine requester role from header
    const userData = req.headers['x-user-data'];
    const user = userData ? JSON.parse(userData) : {};
    const role = user.role;

    // Role-based filtering for the 3-tier approval flow
    let filterSql = '';
    if (role === 'front_office') {
      filterSql = `mpl.authorization_level = 'front_office'`;
    } else if (role === 'back_office_verifier') {
      filterSql = `mpl.authorization_level = 'back_office_verifier'`;
    } else if (role === 'back_office_final' || role === 'admin') {
      filterSql = `(mpl.authorization_level = 'back_office_final' OR mpl.authorization_level IS NULL)`;
    } else {
      filterSql = `1=0`;
    }

    const [rows] = await db.query(`
      SELECT DISTINCT
        mpl.deal_id,
        mpl.deal_number,
        mpl.maturity_action,
        mpl.processed_date AS first_logged_date,
        COALESCE(mpl.authorization_level, 'back_office_final') AS approval_level,
        CASE mpl.authorization_level 
          WHEN 'front_office' THEN 'Front Office'
          WHEN 'back_office_verifier' THEN 'Back Office Verifier'
          WHEN 'back_office_final' THEN 'Back Office Final'
          ELSE 'Back Office Final' END AS approval_level_display,
        CASE mpl.authorization_level 
          WHEN 'front_office' THEN 1 
          WHEN 'back_office_verifier' THEN 2 
          WHEN 'back_office_final' THEN 3 
          ELSE 0 END AS current_stage,
        -- Get product type and maturity amount
        CASE 
          WHEN mm.id IS NOT NULL THEN 'money_market'
          WHEN g.id IS NOT NULL THEN 'gsec'
          WHEN rd.id IS NOT NULL THEN 'repo'
          ELSE 'unknown'
        END AS product_type,
        -- Maturity amounts based on product type
        CASE 
          WHEN mm.id IS NOT NULL THEN 
            mm.principal_amount + (mm.principal_amount * mm.interest_rate * DATEDIFF(mm.maturity_date, ?) / 36500)
          WHEN g.id IS NOT NULL THEN g.settlement_amount
          WHEN rd.id IS NOT NULL THEN rd.maturity_amount
          ELSE 0
        END AS maturity_amount,
        -- Additional product-specific fields
        CASE 
          WHEN mm.id IS NOT NULL THEN mm.principal_amount
          WHEN g.id IS NOT NULL THEN g.face_value
          WHEN rd.id IS NOT NULL THEN rd.principal_amount
          ELSE 0
        END AS principal_amount,
        CASE 
          WHEN mm.id IS NOT NULL THEN (mm.principal_amount * mm.interest_rate * DATEDIFF(mm.maturity_date, ?) / 36500)
          WHEN g.id IS NOT NULL THEN g.accrued_interest
          WHEN rd.id IS NOT NULL THEN rd.interest_amount
          ELSE 0
        END AS interest_amount,
        -- Counterparty names
        CASE
          WHEN mm.id IS NOT NULL THEN COALESCE(corp_mm.short_name, ind_mm.short_name, joint_mm.short_name, mm.counterparty_id)
          WHEN g.id IS NOT NULL THEN COALESCE(corp_g.short_name, ind_g.short_name, joint_g.short_name, g.counterparty_id)
          WHEN rd.id IS NOT NULL THEN COALESCE(corp_rd.short_name, ind_rd.short_name, joint_rd.short_name, rd.counterparty_id)
          ELSE 'Unknown'
        END AS counterparty_name,
        -- Reference deal: for a GSec Sell, the Buy deal it originated from
        -- (so the user can trace back why this position is maturing/settling
        -- this way). Buy-type GSec rows and Money Market/Repo deals have no
        -- separate reference - they ARE the originating deal.
        CASE WHEN g.id IS NOT NULL THEN g.buy_deal_number ELSE NULL END AS reference_deal_number,
        CASE WHEN g.id IS NOT NULL THEN g.isin_number ELSE NULL END AS gsec_isin,
        CASE WHEN g.id IS NOT NULL THEN g.portfolio ELSE NULL END AS gsec_portfolio
      FROM maturity_processing_log mpl
      LEFT JOIN money_market_deals mm ON mpl.deal_id = mm.id
      LEFT JOIN gsec g ON mpl.deal_id = g.id
      LEFT JOIN repo_deals rd ON mpl.deal_id = rd.id
      -- Counterparty joins for money market
      LEFT JOIN counterparty_master_corporate corp_mm ON mm.counterparty_id = corp_mm.id
      LEFT JOIN counterparty_master_individual ind_mm ON mm.counterparty_id = ind_mm.id
      LEFT JOIN counterparty_master_joint joint_mm ON mm.counterparty_id = joint_mm.id
      -- Counterparty joins for gsec (g.counterparty_id is a prefixed id like 'c12'/'i5'/'j3')
      LEFT JOIN counterparty_master_corporate corp_g ON (g.counterparty_id LIKE 'c%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = corp_g.id) OR (g.counterparty_id = corp_g.id)
      LEFT JOIN counterparty_master_individual ind_g ON (g.counterparty_id LIKE 'i%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = ind_g.id) OR (g.counterparty_id = ind_g.id)
      LEFT JOIN counterparty_master_joint joint_g ON (g.counterparty_id LIKE 'j%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = joint_g.id) OR (g.counterparty_id = joint_g.id)
      -- Counterparty joins for repo
      LEFT JOIN counterparty_master_corporate corp_rd ON rd.counterparty_id = corp_rd.id
      LEFT JOIN counterparty_master_individual ind_rd ON rd.counterparty_id = ind_rd.id
      LEFT JOIN counterparty_master_joint joint_rd ON rd.counterparty_id = joint_rd.id
      WHERE mpl.processed_date <= ?
        AND ${filterSql}
        -- Exclude deals that are already matured
        AND COALESCE(mm.matured, g.matured, rd.matured, 0) = 0
      ORDER BY mpl.processed_date DESC, mpl.deal_id DESC
    `, [targetDate, targetDate, targetDate]);

    // Opening balance per GSec row - the ISIN/portfolio's available balance as
    // of the day before processed_date, reusing the shared opening-balance
    // helper (same one used by the Daily Portfolio Balancing Report).
    const Gsec = require('../models/gsec');
    const dayBefore = (d) => {
      const dt = new Date(d);
      dt.setDate(dt.getDate() - 1);
      return dt.toISOString().slice(0, 10);
    };
    const balanceCache = new Map();
    for (const row of rows) {
      if (!row.gsec_isin) continue;
      const asOfDate = dayBefore(row.first_logged_date || targetDate);
      const cacheKey = `${row.gsec_isin}|${row.gsec_portfolio || ''}|${asOfDate}`;
      if (!balanceCache.has(cacheKey)) {
        try {
          balanceCache.set(cacheKey, await Gsec.getOpeningBalance(row.gsec_isin, row.gsec_portfolio, asOfDate));
        } catch (e) {
          balanceCache.set(cacheKey, null);
        }
      }
      row.opening_balance = balanceCache.get(cacheKey);
    }

    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching maturity blotter:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Approve maturities per role; only final posts entries
MaturityController.approveMaturities = async (req, res) => {
  try {
    const { dealIds, processDate, maturityAction, bankPaymentCode, bankAccountId } = req.body || {};
    if (!Array.isArray(dealIds) || dealIds.length === 0) {
      return res.status(400).json({ success: false, error: 'dealIds array is required' });
    }
    if (!maturityAction) {
      return res.status(400).json({ success: false, error: 'maturityAction is required' });
    }

    // Role from user header
    const userData = req.headers['x-user-data'];
    const user = userData ? JSON.parse(userData) : null;
    const role = user?.role;
    if (!role) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const db = require('../config/database');
    const placeholders = dealIds.map(() => '?').join(',');

    // Front office: advance front_office -> back_office_verifier
    if (role === 'front_office') {
      const [upd] = await db.query(`
        UPDATE maturity_processing_log 
        SET authorization_level = 'back_office_verifier'
        WHERE deal_id IN (${placeholders}) AND maturity_action = ? AND authorization_level = 'front_office'
      `, [...dealIds, maturityAction]);
      return res.json({ success: true, message: `Maturity processing advanced to Back Office Verifier for ${upd.affectedRows || 0} deal(s)` });
    }

    // Back office verifier: advance back_office_verifier -> back_office_final
    if (role === 'back_office_verifier') {
      const [upd] = await db.query(`
        UPDATE maturity_processing_log 
        SET authorization_level = 'back_office_final'
        WHERE deal_id IN (${placeholders}) AND maturity_action = ? AND authorization_level = 'back_office_verifier'
      `, [...dealIds, maturityAction]);
      return res.json({ success: true, message: `Maturity processing advanced to Back Office Final for ${upd.affectedRows || 0} deal(s)` });
    }

    // Back office final (or admin): post entries and set matured
    if (role === 'back_office_final' || role === 'admin') {
      // Reuse processMaturities flow to post entries; fabricate req/res minimal
      req.body = { dealIds, processDate, maturityAction, bankPaymentCode, bankAccountId };
      
      // Capture cashflow for each deal after final approval
      try {
        const db = require('../config/database');
        for (const dealId of dealIds) {
          // Get maturity details for cashflow capture
          const [maturityRows] = await db.query(`
            SELECT mpl.deal_id, mpl.maturity_action, mpl.total_amount, mpl.processed_date
            FROM maturity_processing_log mpl
            WHERE mpl.deal_id = ? AND mpl.maturity_action = ?
            ORDER BY mpl.created_at DESC LIMIT 1
          `, [dealId, maturityAction]);
          
          if (maturityRows.length > 0) {
            const maturity = maturityRows[0];

            // Infer product type
            let productType = 'money_market';
            let found = false;
            try {
              const [mm] = await db.query('SELECT id FROM money_market_deals WHERE id = ? LIMIT 1', [dealId]);
              if (mm.length) { productType = 'money_market'; found = true; }
            } catch (_) {}
            if (!found) {
              try {
                const [g] = await db.query('SELECT id FROM gsec WHERE id = ? LIMIT 1', [dealId]);
                if (g.length) { productType = 'gsec'; found = true; }
              } catch (_) {}
            }
            if (!found) {
              try {
                const [r] = await db.query('SELECT id FROM repo_deals WHERE id = ? LIMIT 1', [dealId]);
                if (r.length) { productType = 'repo'; found = true; }
              } catch (_) {}
            }

            await CashflowCaptureService.captureMaturityCashflow(
              maturity.deal_id,
              productType,
              maturity.maturity_action,
              maturity.total_amount,
              maturity.processed_date
            );
          }
        }
      } catch (cashflowError) {
        console.error('Error capturing cashflow for maturity:', cashflowError);
        // Don't fail the main process if cashflow capture fails
      }
      
      return await MaturityController.processMaturities(req, res);
    }

    return res.status(403).json({ success: false, error: 'Role not allowed' });
  } catch (error) {
    console.error('Error approving maturities:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get deals available for premature maturity
 * Returns all deals that are not yet matured (matured = 0 or NULL)
 */
MaturityController.getPrematureMaturityDeals = async (req, res) => {
  try {
    const { productType = 'all' } = req.query;
    const db = require('../config/database');
    const { getSystemDay } = require('../models/systemDayModel');
    const systemDay = await getSystemDay();
    const effectiveDateStr = toYmd(systemDay?.system_date) || toYmd(new Date());
    
    let deals = [];
    
    // Get GSEC deals
    if (productType === 'all' || productType === 'gsec') {
      const gsecQuery = `
        SELECT 
          g.id,
          g.deal_number,
          g.isin_number as isin,
          g.counterparty_id as counterparty,
          COALESCE(
            corp.short_name,
            ind.short_name,
            joint.short_name,
            CONCAT('ID:', g.counterparty_id)
          ) as counterparty_name,
          g.face_value,
          g.maturity_date,
          g.status,
          DATEDIFF(g.maturity_date, ?) as days_to_maturity,
          'gsec' as product_type
        FROM gsec g
        LEFT JOIN counterparty_master_corporate corp ON 
          (g.counterparty_id LIKE 'c%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = corp.id)
          OR (g.counterparty_id = corp.id)
        LEFT JOIN counterparty_master_individual ind ON 
          (g.counterparty_id LIKE 'i%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = ind.id)
          OR (g.counterparty_id = ind.id)
        LEFT JOIN counterparty_master_joint joint ON 
          (g.counterparty_id LIKE 'j%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = joint.id)
          OR (g.counterparty_id = joint.id)
        WHERE COALESCE(g.matured, 0) = 0
          AND g.status = 'final_approved'
          AND g.transaction_type = 'Buy'
        ORDER BY g.maturity_date ASC
      `;
      const [gsecRows] = await db.query(gsecQuery, [effectiveDateStr]);
      deals = deals.concat(gsecRows.map(row => ({ ...row, product_type: 'gsec' })));
    }
    
    // Get Money Market deals
    if (productType === 'all' || productType === 'money_market') {
      const mmQuery = `
        SELECT 
          mmd.id,
          mmd.deal_number,
          NULL as isin,
          mmd.counterparty_id as counterparty,
          COALESCE(
            corp.short_name,
            ind.short_name,
            joint.short_name,
            mmd.counterparty_id
          ) as counterparty_name,
          mmd.principal_amount as face_value,
          mmd.maturity_date,
          mmd.status,
          DATEDIFF(mmd.maturity_date, ?) as days_to_maturity,
          'money_market' as product_type
        FROM money_market_deals mmd
        LEFT JOIN counterparty_master_corporate corp ON mmd.counterparty_id = corp.id
        LEFT JOIN counterparty_master_individual ind ON mmd.counterparty_id = ind.id
        LEFT JOIN counterparty_master_joint joint ON mmd.counterparty_id = joint.id
        WHERE COALESCE(mmd.matured, 0) = 0
          AND mmd.status = 'Approved'
        ORDER BY mmd.maturity_date ASC
      `;
      const [mmRows] = await db.query(mmQuery, [effectiveDateStr]);
      deals = deals.concat(mmRows.map(row => ({ ...row, product_type: 'money_market' })));
    }
    
    // Get Repo deals
    if (productType === 'all' || productType === 'repo') {
      const repoQuery = `
        SELECT 
          rd.id,
          rd.deal_number,
          rd.isin_number as isin,
          rd.counterparty_id as counterparty,
          COALESCE(
            corp.short_name,
            ind.short_name,
            joint.short_name,
            rd.counterparty_id
          ) as counterparty_name,
          rd.principal_amount as face_value,
          rd.maturity_date,
          rd.status,
          DATEDIFF(rd.maturity_date, ?) as days_to_maturity,
          'repo' as product_type
        FROM repo_deals rd
        LEFT JOIN counterparty_master_corporate corp ON rd.counterparty_id = corp.id
        LEFT JOIN counterparty_master_individual ind ON rd.counterparty_id = ind.id
        LEFT JOIN counterparty_master_joint joint ON rd.counterparty_id = joint.id
        WHERE COALESCE(rd.matured, 0) = 0
          AND rd.approval_status = 'final_approved'
        ORDER BY rd.maturity_date ASC
      `;
      const [repoRows] = await db.query(repoQuery, [effectiveDateStr]);
      deals = deals.concat(repoRows.map(row => ({ ...row, product_type: 'repo' })));
    }

    // Get Buyback deals
    if (productType === 'all' || productType === 'buyback') {
      const buybackQuery = `
        SELECT
          bb.id,
          bb.deal_number,
          bb.leg1_isin as isin,
          bb.leg1_counterparty as counterparty,
          COALESCE(
            corp.short_name,
            ind.short_name,
            joint.short_name,
            CONCAT('ID:', bb.leg1_counterparty)
          ) as counterparty_name,
          COALESCE(bb.leg1_adjusted_face_value, bb.leg1_face_value) as face_value,
          bb.leg1_face_value as leg1_face_value,
          bb.leg1_value_date as leg1_value_date,
          bb.leg1_settlement_amount as leg1_settlement_amount,
          bb.leg1_interest_rate as leg1_interest_rate,
          bb.leg2_accrued_interest as leg2_accrued_interest,
          COALESCE(bb.coupon_rate, im.coupon_rate) as coupon_rate,
          COALESCE(bb.issue_date, im.issue_date) as issue_date,
          COALESCE(bb.coupon_date1, im.coupon_date_1) as coupon_date1,
          COALESCE(bb.coupon_date2, im.coupon_date_2) as coupon_date2,
          COALESCE(im.day_basis, 364) as day_basis,
          bb.leg2_value_date as maturity_date,
          bb.deal_status as status,
          DATEDIFF(bb.leg2_value_date, ?) as days_to_maturity,
          'buyback' as product_type
        FROM buyback_deals bb
        LEFT JOIN isin_master im
          ON TRIM(bb.leg1_isin) COLLATE utf8mb4_unicode_ci = TRIM(im.isin_number) COLLATE utf8mb4_unicode_ci
        LEFT JOIN counterparty_master_corporate corp ON
          (bb.leg1_counterparty LIKE 'c%' AND CAST(SUBSTRING(bb.leg1_counterparty, 2) AS UNSIGNED) = corp.id)
          OR (bb.leg1_counterparty = corp.id)
        LEFT JOIN counterparty_master_individual ind ON
          (bb.leg1_counterparty LIKE 'i%' AND CAST(SUBSTRING(bb.leg1_counterparty, 2) AS UNSIGNED) = ind.id)
          OR (bb.leg1_counterparty = ind.id)
        LEFT JOIN counterparty_master_joint joint ON
          (bb.leg1_counterparty LIKE 'j%' AND CAST(SUBSTRING(bb.leg1_counterparty, 2) AS UNSIGNED) = joint.id)
          OR (bb.leg1_counterparty = joint.id)
        WHERE bb.deal_status = 'Approved'
          AND bb.approved_at IS NOT NULL
          AND DATE(bb.leg2_value_date) >= ?
        ORDER BY bb.leg2_value_date ASC
      `;
      const [buybackRows] = await db.query(buybackQuery, [effectiveDateStr, effectiveDateStr]);
      deals = deals.concat(buybackRows.map(row => ({ ...row, product_type: 'buyback' })));
    }

    res.json({
      success: true,
      data: deals,
      message: `Found ${deals.length} deals available for premature maturity`
    });
  } catch (error) {
    console.error('Error fetching premature maturity deals:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch premature maturity deals: ' + error.message
    });
  }
};

/**
 * Process premature maturity - update maturity date for selected deals
 */
MaturityController.processPrematureMaturity = async (req, res) => {
  try {
    const { dealIds, prematureMaturityDate, productType } = req.body;
    
    if (!dealIds || !Array.isArray(dealIds) || dealIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'dealIds array is required'
      });
    }
    
    if (!prematureMaturityDate) {
      return res.status(400).json({
        success: false,
        error: 'prematureMaturityDate is required'
      });
    }
    
    if (!productType) {
      return res.status(400).json({
        success: false,
        error: 'productType is required'
      });
    }
    
    // Validate date format
    const maturityDate = new Date(`${prematureMaturityDate}T00:00:00`);
    if (isNaN(maturityDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
    }
    
    // Ensure date is not before current system day (not local machine date)
    const { getSystemDay } = require('../models/systemDayModel');
    const systemDay = await getSystemDay();
    const baselineDateStr = toYmd(systemDay?.system_date) || toYmd(new Date());
    const baselineDate = new Date(`${baselineDateStr}T00:00:00`);
    baselineDate.setHours(0, 0, 0, 0);
    if (maturityDate < baselineDate) {
      return res.status(400).json({
        success: false,
        error: `Premature maturity date cannot be before system day (${baselineDateStr})`
      });
    }
    
    const db = require('../config/database');
    const user = req.headers['x-user-data'] ? JSON.parse(req.headers['x-user-data']) : null;
    const userId = user?.id || null;
    
    const dateStr = prematureMaturityDate.split('T')[0]; // Ensure YYYY-MM-DD format
    
    let updatedCount = 0;
    const errors = [];
    const product = String(productType || '').toLowerCase();
    const allowedProducts = new Set(['gsec', 'money_market', 'repo', 'buyback']);
    if (!allowedProducts.has(product)) {
      return res.status(400).json({
        success: false,
        error: `Unsupported productType "${productType}". Use gsec, money_market, repo, or buyback.`
      });
    }

    // Route strictly by productType. IDs are not unique across product tables
    // (gsec.id=142 and repo_deals.id=142 are different deals), so falling through
    // GSEC → MM → Repo caused false "success" on the wrong product.
    for (const dealId of dealIds) {
      try {
        let dealUpdated = false;

        if (product === 'gsec') {
          // Buyback leg-2 Buy that has not settled yet (value_date still in the
          // future) must be prematured by moving SETTLEMENT dates — not by
          // stamping maturity_date (that leaves a row that "matures" before it
          // settles and drops out of the GSec report / daily maturity cashflow).
          const [gsecRows] = await db.query(`
            SELECT id, deal_number, buyback_deal_id, value_date
            FROM gsec
            WHERE id = ?
              AND COALESCE(matured, 0) = 0
              AND status = 'final_approved'
            LIMIT 1
          `, [dealId]);

          if (gsecRows.length > 0) {
            const gsecDeal = gsecRows[0];
            const valueDateStr = gsecDeal.value_date
              ? new Date(gsecDeal.value_date).toISOString().slice(0, 10)
              : null;
            const isUnsettledBuybackLeg2 =
              gsecDeal.buyback_deal_id != null && valueDateStr && valueDateStr > dateStr;

            let logNote;
            if (isUnsettledBuybackLeg2) {
              await db.query(`
                UPDATE gsec
                SET value_date = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `, [dateStr, dealId]);
              await db.query(`
                UPDATE buyback_deals
                SET leg2_value_date = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `, [dateStr, gsecDeal.buyback_deal_id]);
              logNote = `Premature maturity (buyback leg2 early settlement): value_date and buyback leg2_value_date updated to ${dateStr}; settlement amounts unchanged`;
            } else {
              await db.query(`
                UPDATE gsec
                SET maturity_date = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `, [dateStr, dealId]);
              logNote = `Premature maturity: Original maturity date updated to ${dateStr}`;
            }

            updatedCount++;
            dealUpdated = true;
            await db.query(`
              INSERT INTO maturity_processing_log
              (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount,
               processed_date, processed_by, authorization_level, notes)
              SELECT
                id, deal_number, 'premature_maturity', face_value, 0, face_value,
                ?, ?, 'system', ?
              FROM gsec WHERE id = ?
            `, [dateStr, userId, logNote, dealId]);
          }
        } else if (product === 'money_market') {
          const [mmResult] = await db.query(`
            UPDATE money_market_deals
            SET maturity_date = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND COALESCE(matured, 0) = 0
              AND status = 'Approved'
          `, [dateStr, dealId]);

          if (mmResult.affectedRows > 0) {
            updatedCount++;
            dealUpdated = true;
            await db.query(`
              INSERT INTO maturity_processing_log
              (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount,
               processed_date, processed_by, authorization_level, notes)
              SELECT
                id, deal_number, 'premature_maturity', principal_amount, 0, principal_amount,
                ?, ?, 'system', ?
              FROM money_market_deals WHERE id = ?
            `, [dateStr, userId, `Premature maturity: Original maturity date updated to ${dateStr}`, dealId]);
          }
        } else if (product === 'repo') {
          const [repoRows] = await db.query(
            `SELECT id, deal_number, deal_type, principal_amount, interest_amount,
                    settlement_mode, maturity_date, matured, approval_status
             FROM repo_deals
             WHERE id = ?
               AND COALESCE(matured, 0) = 0
               AND approval_status = 'final_approved'
             LIMIT 1`,
            [dealId]
          );

          if (repoRows.length > 0) {
            const repoDeal = repoRows[0];
            const [repoResult] = await db.query(
              `UPDATE repo_deals
               SET maturity_date = ?,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ?
                 AND COALESCE(matured, 0) = 0
                 AND approval_status = 'final_approved'`,
              [dateStr, dealId]
            );

            if (repoResult.affectedRows > 0) {
              updatedCount++;
              dealUpdated = true;
              let logNote = `Premature maturity: Original maturity date updated to ${dateStr}`;
              const systemDayStr = toYmd(systemDay?.system_date);
              if (systemDayStr && dateStr <= systemDayStr) {
                const posted = await postRepoMaturityLedger(
                  { ...repoDeal, maturity_date: dateStr },
                  { entryDate: dateStr }
                );
                if (!posted.success) {
                  errors.push(
                    `Deal ${repoDeal.deal_number}: maturity date updated but ledger post failed: ${posted.error}`
                  );
                  logNote += `; ledger post failed: ${posted.error}`;
                } else if (posted.posted) {
                  logNote +=
                    '; posted Repo maturity journal (DR 780/CR 752 interest reversal, DR 308/CR Bank principal, DR 768/CR Bank interest)';
                } else {
                  logNote += `; ledger ${posted.skipped || 'already present'}`;
                }
              } else {
                logNote += '; ledger will post on EOD when the new maturity date is due';
              }
              await db.query(
                `INSERT INTO maturity_processing_log
                 (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount,
                  processed_date, processed_by, authorization_level, notes)
                 SELECT
                   id, deal_number, 'premature_maturity', principal_amount, interest_amount, maturity_amount,
                   ?, ?, 'system', ?
                 FROM repo_deals WHERE id = ?`,
                [dateStr, userId, logNote, dealId]
              );
            }
          }
        } else if (product === 'buyback') {
          const [bbResult] = await db.query(`
            UPDATE buyback_deals
            SET leg2_value_date = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deal_status = 'Approved'
              AND approved_at IS NOT NULL
          `, [dateStr, dealId]);

          if (bbResult.affectedRows > 0) {
            updatedCount++;
            dealUpdated = true;
            await db.query(`
              INSERT INTO maturity_processing_log
              (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount,
               processed_date, processed_by, authorization_level, notes)
              SELECT
                id,
                deal_number,
                'premature_maturity',
                COALESCE(leg1_adjusted_face_value, leg1_face_value),
                0,
                COALESCE(leg2_settlement_amount, leg1_settlement_amount, 0),
                ?, ?, 'system', ?
              FROM buyback_deals WHERE id = ?
            `, [dateStr, userId, `Premature maturity: leg2_value_date updated to ${dateStr}`, dealId]);
          }
        }

        if (!dealUpdated) {
          errors.push(`Deal ID ${dealId}: Deal not found or already matured or incorrect status for productType=${product}`);
        }
      } catch (err) {
        errors.push(`Deal ID ${dealId}: ${err.message}`);
        console.error(`Error updating deal ${dealId}:`, err);
      }
    }
    
    if (updatedCount === 0) {
      return res.status(400).json({
        success: false,
        error: 'No deals were updated. Please check that deals are not already matured and have correct status.',
        errors
      });
    }
    
    res.json({
      success: true,
      message: `Successfully updated maturity date for ${updatedCount} ${product} deal(s) to ${dateStr}`,
      updatedCount,
      productType: product,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error processing premature maturity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process premature maturity: ' + error.message
    });
  }
};

// Process premature maturity for Buyback deals with recalculated Leg 2 settlement
// Accepts { deals: [{ dealId, leg1InterestRate, leg2ValueDate, dayCountBasis }] }
MaturityController.processBuybackPrematureMaturity = async (req, res) => {
  try {
    const db = require('../config/database');
    const Gsec = require('../models/gsec');
const {
  getCouponPeriodLengthDaysFromIsinSchedule,
  resolveIsinCouponDates,
  getCouponPeriodEOverride
} = require('../services/gsecCouponPeriod');
const { solveYieldFromPrice } = require('../utils/bondPricingNVP');
    const { deals } = req.body || {};
    const userId = resolveRequestUserId(req);
    const [buybackLinkColRows] = await db.query(
      `SELECT 1
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'gsec'
         AND COLUMN_NAME = 'buyback_deal_id'
       LIMIT 1`
    );
    const hasBuybackDealId = Array.isArray(buybackLinkColRows) && buybackLinkColRows.length > 0;
    const [repoColsRows] = await db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'repo_deals'`
    );
    const repoColumnSet = new Set((repoColsRows || []).map(r => r.COLUMN_NAME));
    const repoLinkColumns = ['buy_deal_number', 'source_buy_deal_number', 'gsec_deal_number', 'linked_deal_number']
      .filter(c => repoColumnSet.has(c));

    if (!Array.isArray(deals) || deals.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'deals array is required'
      });
    }

    const results = [];
    const errors = [];

    // Mirrors calculateDaysBetween in FixedIncomeBuyBackPage.js (Math.ceil of ms diff, absolute)
    const calcDaysBetween = (d1Str, d2Str) => {
      if (!d1Str || !d2Str) return 0;
      const d1 = new Date(d1Str);
      const d2 = new Date(d2Str);
      if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;
      const diffMs = Math.abs(d2 - d1);
      return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    };

    const round4 = (n) => Math.round(n * 10000) / 10000;

    // Mirrors calculateDirtyPriceFromSettlement in FixedIncomeBuyBackPage.js
    const calcDirtyPricePer100 = (settlementAmount, faceValue) => {
      const settlement = parseFloat(settlementAmount);
      const face = parseFloat(faceValue);
      if (!isFinite(settlement) || !isFinite(face) || face <= 0) return null;
      return round4((settlement / face) * 100);
    };

    // Mirrors calculateAccruedInterestPer100 in FixedIncomeBuyBackPage.js
    const calcAccruedInterestPer100 = (couponRate, valueDate, issueDate, couponDate1, couponDate2) => {
      if (!couponRate || !valueDate || !issueDate || !couponDate1 || !couponDate2) {
        return null;
      }

      const cr = parseFloat(couponRate) / 100;
      const settle = new Date(valueDate);
      const issue = new Date(issueDate);
      if (!isFinite(cr) || isNaN(settle.getTime()) || isNaN(issue.getTime())) {
        return null;
      }

      const frequency = 2;
      const couponPer100 = (100 * cr) / frequency;
      const monthsPerPeriod = 12 / frequency;

      let lastCoupon = new Date(issue);
      while (lastCoupon <= settle) {
        lastCoupon.setMonth(lastCoupon.getMonth() + monthsPerPeriod);
      }
      lastCoupon.setMonth(lastCoupon.getMonth() - monthsPerPeriod);

      const nextCoupon = new Date(lastCoupon);
      nextCoupon.setMonth(nextCoupon.getMonth() + monthsPerPeriod);

      const daysInPeriod = calcDaysBetween(nextCoupon, lastCoupon);
      const daysAccrued = calcDaysBetween(settle, lastCoupon);
      if (!daysInPeriod) return null;

      return round4(couponPer100 * (daysAccrued / daysInPeriod));
    };

    for (const item of deals) {
      const {
        dealId,
        leg1InterestRate,
        leg2ValueDate,
        dayCountBasis
      } = item || {};

      if (!dealId || leg1InterestRate === undefined || leg1InterestRate === null || !leg2ValueDate) {
        errors.push(`Invalid payload for deal ${dealId || '(missing id)'}: dealId, leg1InterestRate, leg2ValueDate are required`);
        continue;
      }

      // Default 364 to match buyback / GOSL ISIN convention (isin_master.day_basis).
      const basis = parseInt(dayCountBasis, 10) || 364;
      if (basis !== 365 && basis !== 364) {
        errors.push(`Deal ID ${dealId}: dayCountBasis must be 365 or 364`);
        continue;
      }

      const connection = await db.pool.getConnection();
      try {
        await connection.beginTransaction();

        const [rows] = await connection.query(
          `SELECT id, deal_number, leg1_value_date, leg1_settlement_amount, leg1_face_value,
                  leg2_face_value, leg2_adjusted_face_value, leg2_value_date, leg2_transaction_type,
                  leg2_isin, leg2_counterparty, leg2_portfolio, leg2_strategy, leg2_custodian, leg2_settlement_mode,
                  leg2_trade_type, leg2_trade_date, leg2_currency, leg1_broker, leg1_brokerage,
                  leg2_accrued_interest, leg2_yield_rate,
                  coupon_rate, issue_date, coupon_date1, coupon_date2,
                  deal_status, approved_at, fund_movement
           FROM buyback_deals
           WHERE id = ?
           FOR UPDATE`,
          [dealId]
        );

        if (!rows || rows.length === 0) {
          await connection.rollback();
          errors.push(`Deal ID ${dealId}: not found`);
          continue;
        }

        const deal = rows[0];
        if (deal.deal_status !== 'Approved' || !deal.approved_at) {
          await connection.rollback();
          errors.push(`Deal ID ${dealId}: only Approved deals with approved_at can be prematurely matured`);
          continue;
        }

        const leg1Settlement = parseFloat(deal.leg1_settlement_amount);
        const rate = parseFloat(leg1InterestRate);
        const days = calcDaysBetween(deal.leg1_value_date, leg2ValueDate);

        if (!isFinite(leg1Settlement) || !isFinite(rate)) {
          await connection.rollback();
          errors.push(`Deal ID ${dealId}: invalid settlement amount or rate`);
          continue;
        }

        const interest = leg1Settlement * (rate / 100) * (days / basis);
        const newLeg2Settlement = Math.round((leg1Settlement + interest) * 100) / 100;

        const dirtyPricePer100 = calcDirtyPricePer100(newLeg2Settlement, deal.leg1_face_value);

        // buyback_deals.coupon_* columns are usually NULL, so fall back to the ISIN
        // master coupon calendar. Without this, calcAccruedInterestPer100 returns null
        // and the code drops to the stored leg2_accrued_interest, which on some legacy
        // rows is a sentinel/garbage value (e.g. 999999.9999) that corrupts the clean
        // price (clean = dirty - accrued).
        const [leg2IsinMasterRows] = await connection.query(
          'SELECT coupon_rate, issue_date, coupon_date_1, coupon_date_2, maturity_date FROM isin_master WHERE isin_number = ? LIMIT 1',
          [deal.leg2_isin]
        );
        const leg2IsinMaster = (leg2IsinMasterRows && leg2IsinMasterRows[0]) || {};

        const computedAccrued = calcAccruedInterestPer100(
          deal.coupon_rate || leg2IsinMaster.coupon_rate,
          leg2ValueDate,
          deal.issue_date || leg2IsinMaster.issue_date,
          deal.coupon_date1 || leg2IsinMaster.coupon_date_1,
          deal.coupon_date2 || leg2IsinMaster.coupon_date_2
        );

        // Only trust the stored leg2 accrued as a fallback when it is a sane per-100
        // figure (0 <= accrued <= dirty price). This rejects sentinel/garbage values.
        const rawFallbackAccrued = parseFloat(deal.leg2_accrued_interest);
        const dirtyCeiling = dirtyPricePer100 != null ? dirtyPricePer100 : 100;
        const fallbackAccruedIsSane =
          isFinite(rawFallbackAccrued) && rawFallbackAccrued >= 0 && rawFallbackAccrued <= dirtyCeiling;
        const accruedInterestPer100 = computedAccrued != null
          ? computedAccrued
          : (fallbackAccruedIsSane ? round4(rawFallbackAccrued) : 0);

        const cleanPricePer100 = dirtyPricePer100 != null
          ? round4(dirtyPricePer100 - accruedInterestPer100)
          : null;
        const finalDirtyPricePer100 = cleanPricePer100 != null
          ? round4(cleanPricePer100 + accruedInterestPer100)
          : null;

        // The settlement/price above are derived from simple interest on the
        // financing rate, not from the bond's yield - so leg2_yield_rate would
        // otherwise be left stale at whatever yield was stored before this
        // premature maturity. Back-solve the yield implied by the new clean
        // price so it stays consistent with reality for future reporting.
        let impliedYieldRate = parseFloat(deal.leg2_yield_rate);
        if (cleanPricePer100 != null) {
          const solvedYield = solveYieldFromPrice({
            targetCleanPrice: cleanPricePer100,
            faceValue: 100,
            couponRate: deal.coupon_rate || leg2IsinMaster.coupon_rate,
            systemDate: leg2ValueDate,
            maturityDate: deal.maturity_date || leg2IsinMaster.maturity_date,
            issueDate: deal.issue_date || leg2IsinMaster.issue_date,
            couponDate1: deal.coupon_date1 || leg2IsinMaster.coupon_date_1,
            couponDate2: deal.coupon_date2 || leg2IsinMaster.coupon_date_2
          });
          if (solvedYield != null) {
            impliedYieldRate = solvedYield;
          }
        }

        await connection.query(
          `UPDATE buyback_deals
           SET leg1_interest_rate = ?,
               leg1_yield_rate = ?,
               leg2_yield_rate = ?,
               leg2_value_date = ?,
               leg2_settlement_amount = ?,
               leg2_clean_price = ?,
               leg2_dirty_price = ?,
               leg2_accrued_interest = ?,
               updated_at = NOW()
           WHERE id = ? AND deal_status = 'Approved' AND approved_at IS NOT NULL`,
          [
            rate,
            rate,
            impliedYieldRate,
            leg2ValueDate,
            newLeg2Settlement,
            cleanPricePer100,
            finalDirtyPricePer100,
            accruedInterestPer100,
            dealId
          ]
        );

        // Replace linked GSEC Buy row(s) for Sell/Buy flow:
        // block if downstream usage exists, otherwise cancel old and create new from updated Leg 2 details.
        let gsecUpdatedRows = 0;
        let gsecUpdatedDealNumbers = [];
        let oldGsecDealNumber = null;
        let newGsecDealNumber = null;
        let gsecReplacementStatus = 'not_applicable';
        if (deal.leg2_transaction_type === 'Buy') {
          const effectiveLeg2Face = parseFloat(
            deal.leg2_adjusted_face_value !== null && deal.leg2_adjusted_face_value !== undefined
              ? deal.leg2_adjusted_face_value
              : deal.leg2_face_value
          ) || 0;

          const [linkedGsecRows] = hasBuybackDealId
            ? await connection.query(
                `SELECT id, deal_number
                 FROM gsec
                 WHERE transaction_type = 'Buy'
                   AND status = 'final_approved'
                   AND buyback_deal_id = ?`,
                [deal.id]
              )
            : await connection.query(
                `SELECT id, deal_number
                 FROM gsec
                 WHERE transaction_type = 'Buy'
                   AND status = 'final_approved'
                   AND isin_number = ?
                   AND portfolio = ?
                   AND face_value = ?
                   AND value_date = ?
                 ORDER BY created_at DESC`,
                [deal.leg2_isin, deal.leg2_portfolio, effectiveLeg2Face, deal.leg2_value_date]
              );

          if (Array.isArray(linkedGsecRows) && linkedGsecRows.length > 0) {
            const oldGsec = linkedGsecRows[0];
            oldGsecDealNumber = oldGsec.deal_number || null;

            const [sellUsageRows] = await connection.query(
              `SELECT COUNT(*) AS cnt
               FROM gsec
               WHERE transaction_type = 'Sell'
                 AND buy_deal_number = ?`,
              [oldGsecDealNumber]
            );
            const sellUsageCount = Number(sellUsageRows?.[0]?.cnt || 0);

            const [ledgerUsageRows] = await connection.query(
              `SELECT COUNT(*) AS cnt
               FROM ledger_entries
               WHERE deal_number = ?`,
              [oldGsecDealNumber]
            );
            const ledgerUsageCount = Number(ledgerUsageRows?.[0]?.cnt || 0);

            let repoUsageCount = 0;
            if (repoLinkColumns.length > 0) {
              const repoWhere = repoLinkColumns.map(c => `${c} = ?`).join(' OR ');
              const repoParams = repoLinkColumns.map(() => oldGsecDealNumber);
              const [repoUsageRows] = await connection.query(
                `SELECT COUNT(*) AS cnt
                 FROM repo_deals
                 WHERE ${repoWhere}`,
                repoParams
              );
              repoUsageCount = Number(repoUsageRows?.[0]?.cnt || 0);
            }

            if (sellUsageCount > 0 || ledgerUsageCount > 0 || repoUsageCount > 0) {
              const reason = [
                sellUsageCount > 0 ? `sell_refs=${sellUsageCount}` : null,
                ledgerUsageCount > 0 ? `ledger_refs=${ledgerUsageCount}` : null,
                repoUsageCount > 0 ? `repo_refs=${repoUsageCount}` : null
              ].filter(Boolean).join(', ');
              throw new Error(`Cannot replace linked GSEC deal ${oldGsecDealNumber}; downstream usage found (${reason})`);
            }

            // Clear buyback_deal_id on the old row before cancelling it - this column
            // has a UNIQUE constraint (uq_gsec_buyback_deal_id), and the replacement
            // row created below needs to claim the same buyback_deal_id. Without this,
            // the INSERT/UPDATE for the new row fails with a duplicate-key error.
            await connection.query(
              `UPDATE gsec
               SET status = 'cancelled',
                   per_day_accrual = 0,
                   ${hasBuybackDealId ? 'buyback_deal_id = NULL,' : ''}
                   updated_at = NOW()
               WHERE id = ?`,
              [oldGsec.id]
            );
            gsecReplacementStatus = 'old_cancelled_new_created';
          } else {
            gsecReplacementStatus = 'no_existing_link_created_new';
          }

          const [isinData] = await connection.query(
            'SELECT * FROM isin_master WHERE isin_number = ?',
            [deal.leg2_isin]
          );
          if (!isinData || isinData.length === 0) {
            throw new Error(`ISIN master data not found for ${deal.leg2_isin}`);
          }
          const isin = isinData[0];
          const issueDate = deal.issue_date || isin.issue_date;
          const maturityDate = deal.maturity_date || isin.maturity_date;
          const couponDate1 = deal.coupon_date1 || isin.coupon_date_1;
          const couponDate2 = deal.coupon_date2 || isin.coupon_date_2;

          const [couponSchedule] = await connection.query(
            'SELECT * FROM isin_coupon_schedule WHERE isin COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci ORDER BY coupon_date ASC',
            [deal.leg2_isin]
          );
          let lastCouponDate = null;
          let nextCouponDate = null;
          if (couponSchedule && couponSchedule.length > 0 && leg2ValueDate) {
            const valueDateObj = new Date(leg2ValueDate);
            for (let i = 0; i < couponSchedule.length; i++) {
              const couponDateObj = new Date(couponSchedule[i].coupon_date);
              if (couponDateObj <= valueDateObj) lastCouponDate = couponSchedule[i].coupon_date;
              if (couponDateObj > valueDateObj) {
                nextCouponDate = couponSchedule[i].coupon_date;
                break;
              }
            }
          }

          let numberOfDaysInterestAccrued = null;
          let numberOfDaysForCouponPeriod = null;
          // Prefer actual coupon-day schedule from isin_master (with overrides) so E matches calendar days.
          if (leg2ValueDate && maturityDate) {
            try {
              const resolved = resolveIsinCouponDates({
                isin_number: deal.leg2_isin,
                coupon_date_1: couponDate1,
                coupon_date_2: couponDate2
              });
              const sched = getCouponPeriodLengthDaysFromIsinSchedule(
                leg2ValueDate,
                maturityDate,
                resolved.coupon_date_1,
                resolved.coupon_date_2
              );
              if (sched && sched.E > 0) {
                lastCouponDate = sched.lastCoupon.toISOString().slice(0, 10);
                nextCouponDate = sched.nextCoupon.toISOString().slice(0, 10);
                numberOfDaysForCouponPeriod = sched.E;
                const valueDateObj = new Date(leg2ValueDate);
                numberOfDaysInterestAccrued = Math.floor(
                  (valueDateObj - sched.lastCoupon) / (1000 * 60 * 60 * 24)
                );
              }
            } catch (e) {
              console.warn('Failed to compute coupon period from ISIN schedule; using coupon_schedule dates:', e.message);
            }
          }
          const eOverride = getCouponPeriodEOverride(deal.leg2_isin);
          if (eOverride) {
            numberOfDaysForCouponPeriod = eOverride;
          }
          // Fallback to coupon_schedule-derived boundaries if schedule-based calc failed
          if (
            (numberOfDaysForCouponPeriod === null || numberOfDaysForCouponPeriod === undefined) &&
            lastCouponDate &&
            nextCouponDate &&
            leg2ValueDate
          ) {
            const lastDate = new Date(lastCouponDate);
            const nextDate = new Date(nextCouponDate);
            const valueDateObj = new Date(leg2ValueDate);
            numberOfDaysInterestAccrued = Math.floor((valueDateObj - lastDate) / (1000 * 60 * 60 * 24));
            numberOfDaysForCouponPeriod = Math.floor((nextDate - lastDate) / (1000 * 60 * 60 * 24));
          }

          const couponRate = deal.coupon_rate || isin.coupon_rate || 0;
          // Semi-annual coupon: divide the annual coupon by 2 so it matches the
          // per-period coupon stored by the manual GSEC entry page.
          const couponInterest = (effectiveLeg2Face * parseFloat(couponRate || 0)) / 100 / 2;

          const gsecDealData = {
            tradeType: deal.leg2_trade_type || 'BuyBack',
            transactionType: 'Buy',
            counterparty: deal.leg2_counterparty,
            broker: deal.leg1_broker || null,
            dealNumber: null,
            isin: deal.leg2_isin,
            faceValue: effectiveLeg2Face,
            valueDate: leg2ValueDate,
            nextCouponDate,
            lastCouponDate,
            numberOfDaysInterestAccrued,
            numberOfDaysForCouponPeriod,
            accruedInterest: accruedInterestPer100,
            couponInterest,
            cleanPrice: cleanPricePer100,
            dirtyPrice: finalDirtyPricePer100,
            accruedInterestCalculation: accruedInterestPer100,
            accruedInterestSixDecimals: null,
            accruedInterestFor100: null,
            accruedInterestBase: null,
            settlementAmount: newLeg2Settlement,
            settlementMode: deal.leg2_settlement_mode,
            issueDate,
            maturityDate,
            couponDates: couponDate1 && couponDate2 ? `${couponDate1},${couponDate2}` : `${couponDate1 || ''},${couponDate2 || ''}`,
            yield: impliedYieldRate,
            brokerage: deal.leg1_brokerage || 0,
            currency: deal.leg2_currency || 'LKR',
            portfolio: deal.leg2_portfolio,
            strategy: deal.leg2_strategy,
            accruedInterestAdjustment: null,
            cleanPriceAdjustment: null,
            custodian: deal.leg2_custodian,
            tradeDate: deal.leg2_trade_date || leg2ValueDate,
            userId,
            current_approval_level: null,
            status: 'final_approved',
            // Carry the buyback's fund-movement flag so the replacement buy row
            // keeps the correct RVP/RVF basis on its instruction letter.
            fundMovement: deal.fund_movement
          };

          const gsecResult = await Gsec.createWithConnection(gsecDealData, connection);
          const newGsecId = gsecResult?.insertId;
          if (!newGsecId) throw new Error('Failed to create replacement GSEC buy deal');

          if (hasBuybackDealId) {
            await connection.query(
              'UPDATE gsec SET buyback_deal_id = ? WHERE id = ?',
              [deal.id, newGsecId]
            );
          }

          const [newGsecRows] = await connection.query(
            'SELECT deal_number FROM gsec WHERE id = ? LIMIT 1',
            [newGsecId]
          );
          newGsecDealNumber = newGsecRows?.[0]?.deal_number || null;
          gsecUpdatedRows = 1;
          gsecUpdatedDealNumbers = newGsecDealNumber ? [newGsecDealNumber] : [];
        }

        const notes = `Premature maturity: leg1_interest_rate=${rate}, leg2_value_date=${leg2ValueDate}, days=${days}, basis=${basis}, new leg2_settlement_amount=${newLeg2Settlement.toFixed(2)}, leg2_clean_price=${cleanPricePer100 ?? 'NA'}, leg2_dirty_price=${finalDirtyPricePer100 ?? 'NA'}, leg2_yield_rate=${impliedYieldRate ?? 'NA'}`;

        await connection.query(
          `INSERT INTO maturity_processing_log
            (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount,
             processed_date, processed_by, authorization_level, notes)
           VALUES (?, ?, 'premature_maturity', ?, ?, ?, ?, ?, 'system', ?)`,
          [
            deal.id,
            deal.deal_number,
            leg1Settlement,
            Math.round(interest * 100) / 100,
            newLeg2Settlement,
            leg2ValueDate,
            userId,
            notes
          ]
        );

        await connection.commit();

        results.push({
          dealId,
          deal_number: deal.deal_number,
          leg1_settlement_amount: leg1Settlement,
          leg1_interest_rate: rate,
          leg2_value_date: leg2ValueDate,
          days,
          day_count_basis: basis,
          interest: Math.round(interest * 100) / 100,
          leg2_settlement_amount: newLeg2Settlement,
          leg2_clean_price: cleanPricePer100,
          leg2_dirty_price: finalDirtyPricePer100,
          leg2_accrued_interest: accruedInterestPer100,
          leg2_yield_rate: impliedYieldRate,
          gsec_updated_rows: gsecUpdatedRows,
          gsec_updated_deal_numbers: gsecUpdatedDealNumbers,
          old_gsec_deal_number: oldGsecDealNumber,
          new_gsec_deal_number: newGsecDealNumber,
          gsec_replacement_status: gsecReplacementStatus,
          gsec_sync_status: gsecUpdatedRows > 0
            ? `Updated ${gsecUpdatedRows} linked GSEC buy deal(s)`
            : 'No linked GSEC buy deal found for sync (buyback saved)'
        });
      } catch (err) {
        try { await connection.rollback(); } catch (_) { /* ignore */ }
        errors.push(`Deal ID ${dealId}: ${err.message}`);
        console.error(`Error processing buyback premature maturity for deal ${dealId}:`, err);
      } finally {
        connection.release();
      }
    }

    if (results.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No buyback deals were updated',
        errors
      });
    }

    return res.json({
      success: true,
      message: `Successfully recalculated and matured ${results.length} buyback deal(s)`,
      updatedCount: results.length,
      results,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error in processBuybackPrematureMaturity:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process buyback premature maturity: ' + error.message
    });
  }
};