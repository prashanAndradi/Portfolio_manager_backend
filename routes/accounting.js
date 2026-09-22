const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middlewares/auth');

/** Resolve pseudo chart rows (e.g. GSEC_ACCRUAL_INCOME_, GSEC_ACCRUAL_ASSET_C) via account_mappings. */
const LEDGER_ACCOUNT_MAPPING_JOIN = `
      LEFT JOIN account_mappings am ON am.is_active = TRUE
        AND (
          am.mapping_key = coa.account_code
          OR am.mapping_key = TRIM(TRAILING '_' FROM coa.account_code)
          OR coa.account_code REGEXP CONCAT('^', am.mapping_key, '_.*$')
        )
      LEFT JOIN chart_of_accounts coa_resolved
        ON coa_resolved.account_code = am.account_code AND coa_resolved.is_active = TRUE`;

// Get all account types
router.get('/account-types', auth, async (req, res) => {
  try {
    const [accountTypes] = await db.query(`
      SELECT * FROM account_types
      ORDER BY category, name
    `);
    res.json(accountTypes);
  } catch (error) {
    console.error('Error fetching account types:', error);
    res.status(500).json({ error: 'Failed to fetch account types' });
  }
});

// Get chart of accounts (with optional filtering)
router.get('/chart-of-accounts', auth, async (req, res) => {
  try {
    const { accountTypeId, category, isActive, parentAccountId } = req.query;
    
    let query = `
      SELECT coa.*, at.name as account_type_name, at.category, 
             p.name as parent_account_name
      FROM chart_of_accounts coa
      JOIN account_types at ON coa.account_type_id = at.id
      LEFT JOIN chart_of_accounts p ON coa.parent_account_id = p.id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (accountTypeId) {
      query += ` AND coa.account_type_id = ?`;
      params.push(accountTypeId);
    }
    
    if (category) {
      query += ` AND at.category = ?`;
      params.push(category);
    }
    
    if (isActive !== undefined) {
      query += ` AND coa.is_active = ?`;
      params.push(isActive === 'true' || isActive === '1');
    }
    
    if (parentAccountId) {
      if (parentAccountId === 'null') {
        query += ` AND coa.parent_account_id IS NULL`;
      } else {
        query += ` AND coa.parent_account_id = ?`;
        params.push(parentAccountId);
      }
    }
    
    query += ` ORDER BY coa.account_code`;
    
    const [accounts] = await db.query(query, params);
    res.json(accounts);
  } catch (error) {
    console.error('Error fetching chart of accounts:', error);
    res.status(500).json({ error: 'Failed to fetch chart of accounts' });
  }
});

// Create a new account
router.post('/chart-of-accounts', auth, async (req, res) => {
  try {
    const { 
      account_code, 
      name, 
      account_type_id, 
      parent_account_id, 
      description, 
      is_active 
    } = req.body;
    
    // Validate required fields
    if (!account_code || !name || !account_type_id) {
      return res.status(400).json({ error: 'Account code, name, and type are required' });
    }
    
    // Check if account code already exists
    const [existingAccounts] = await db.query(
      'SELECT id FROM chart_of_accounts WHERE account_code = ?', 
      [account_code]
    );
    
    if (existingAccounts.length > 0) {
      return res.status(400).json({ error: 'Account code already exists' });
    }
    
    // Insert new account
    const [result] = await db.query(
      `INSERT INTO chart_of_accounts 
       (account_code, name, account_type_id, parent_account_id, description, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        account_code, 
        name, 
        account_type_id, 
        parent_account_id || null, 
        description || null, 
        is_active !== undefined ? is_active : true
      ]
    );
    
    res.status(201).json({ 
      id: result.insertId,
      message: 'Account created successfully' 
    });
  } catch (error) {
    console.error('Error creating account:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Update an account
router.put('/chart-of-accounts/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      account_code, 
      name, 
      account_type_id, 
      parent_account_id, 
      description, 
      is_active 
    } = req.body;
    
    // Validate required fields
    if (!account_code || !name || !account_type_id) {
      return res.status(400).json({ error: 'Account code, name, and type are required' });
    }
    
    // Check if account code already exists (excluding this account)
    const [existingAccounts] = await db.query(
      'SELECT id FROM chart_of_accounts WHERE account_code = ? AND id != ?', 
      [account_code, id]
    );
    
    if (existingAccounts.length > 0) {
      return res.status(400).json({ error: 'Account code already exists' });
    }
    
    // Update account
    await db.query(
      `UPDATE chart_of_accounts 
       SET account_code = ?, 
           name = ?, 
           account_type_id = ?, 
           parent_account_id = ?, 
           description = ?, 
           is_active = ?
       WHERE id = ?`,
      [
        account_code, 
        name, 
        account_type_id, 
        parent_account_id || null, 
        description || null, 
        is_active !== undefined ? is_active : true,
        id
      ]
    );
    
    res.json({ message: 'Account updated successfully' });
  } catch (error) {
    console.error('Error updating account:', error);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

// Get general ledger entries with filtering options
router.get('/general-ledger', auth, async (req, res) => {
  try {
    const { 
      startDate, 
      endDate, 
      accountId, 
      transactionId,
      limit = 100,
      offset = 0
    } = req.query;
    
    // When ledger points at a chart row whose account_code is an account_mappings key
    // (e.g. GSEC_ACCRUAL_INCOME_, GSEC_ACCRUAL_ASSET_C), show the mapped numeric code and name.
    let query = `
      SELECT le.*, 
             COALESCE(coa_resolved.account_code, coa.account_code) AS account_code,
             COALESCE(coa_resolved.name, coa.name) AS account_name,
             at.category as account_category,
             t.transaction_code, t.description as transaction_description
      FROM ledger_entries le
      LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id
      ${LEDGER_ACCOUNT_MAPPING_JOIN}
      LEFT JOIN account_types at ON coa.account_type_id = at.id
      LEFT JOIN transactions t ON le.transaction_id = t.id
      WHERE 1=1
    `;
    
    const params = [];
    
    // Add count query for pagination
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM ledger_entries le
      LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id
      ${LEDGER_ACCOUNT_MAPPING_JOIN}
      LEFT JOIN account_types at ON coa.account_type_id = at.id
      LEFT JOIN transactions t ON le.transaction_id = t.id
      WHERE 1=1
    `;
    
    // Build the WHERE clause for both queries
    let whereClause = '';
    
    if (startDate) {
      whereClause += ` AND le.entry_date >= ?`;
      params.push(startDate);
    }
    
    if (endDate) {
      whereClause += ` AND le.entry_date <= ?`;
      params.push(endDate);
    }
    
    if (accountId) {
      whereClause += ` AND le.account_id = ?`;
      params.push(accountId);
    }
    
    if (transactionId) {
      whereClause += ` AND le.transaction_id = ?`;
      params.push(transactionId);
    }
    
    // Execute count query
    const [countResult] = await db.query(countQuery + whereClause, params);
    const total = countResult[0].total;
    
    // Add sorting and pagination to the main query
    const fullQuery = query + whereClause + ` ORDER BY le.entry_date DESC, le.id DESC LIMIT ? OFFSET ?`;
    const paginationParams = [...params, parseInt(limit), parseInt(offset)];
    
    const [entries] = await db.query(fullQuery, paginationParams);
    
    res.json({
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      entries
    });
  } catch (error) {
    console.error('Error fetching general ledger:', error);
    res.status(500).json({ error: 'Failed to fetch general ledger' });
  }
});

// Create ledger entries (usually done automatically when transactions are created)
router.post('/ledger-entries', auth, async (req, res) => {
  try {
    const { entries } = req.body;
    
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'At least one ledger entry is required' });
    }
    
    // Validate that debits equal credits
    let totalDebits = 0;
    let totalCredits = 0;
    
    entries.forEach(entry => {
      totalDebits += parseFloat(entry.debit_amount || 0);
      totalCredits += parseFloat(entry.credit_amount || 0);
    });
    
    // Allow for small rounding differences (0.01)
    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      return res.status(400).json({ 
        error: 'Total debits must equal total credits',
        totalDebits,
        totalCredits
      });
    }
    
    // Insert entries
    const insertPromises = entries.map(entry => {
      return db.query(
        `INSERT INTO ledger_entries 
         (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.deal_number || null,
          entry.account_id,
          entry.entry_date,
          entry.debit_amount || 0,
          entry.credit_amount || 0,
          entry.currency || 'LKR',
          entry.description || null
        ]
      );
    });
    
    await Promise.all(insertPromises);
    
    res.status(201).json({ message: 'Ledger entries created successfully' });
  } catch (error) {
    console.error('Error creating ledger entries:', error);
    res.status(500).json({ error: 'Failed to create ledger entries' });
  }
});

// Generate Profit and Loss statement
router.get('/profit-loss', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }
    
    // Get revenue accounts
    const [revenueAccounts] = await db.query(`
      SELECT coa.id, coa.account_code, coa.name,
             COALESCE(SUM(le.credit_amount - le.debit_amount), 0) as balance
      FROM chart_of_accounts coa
      JOIN account_types at ON coa.account_type_id = at.id
      LEFT JOIN ledger_entries le ON coa.id = le.account_id 
                                 AND le.entry_date BETWEEN ? AND ?
      WHERE at.category = 'revenue'
      GROUP BY coa.id
      ORDER BY coa.account_code
    `, [startDate, endDate]);
    
    // Get expense accounts
    const [expenseAccounts] = await db.query(`
      SELECT coa.id, coa.account_code, coa.name,
             COALESCE(SUM(le.debit_amount - le.credit_amount), 0) as balance
      FROM chart_of_accounts coa
      JOIN account_types at ON coa.account_type_id = at.id
      LEFT JOIN ledger_entries le ON coa.id = le.account_id 
                                 AND le.entry_date BETWEEN ? AND ?
      WHERE at.category = 'expense'
      GROUP BY coa.id
      ORDER BY coa.account_code
    `, [startDate, endDate]);
    
    // Calculate totals
    const totalRevenue = revenueAccounts.reduce((sum, account) => sum + parseFloat(account.balance), 0);
    const totalExpenses = expenseAccounts.reduce((sum, account) => sum + parseFloat(account.balance), 0);
    const netProfit = totalRevenue - totalExpenses;
    
    res.json({
      period: {
        startDate,
        endDate
      },
      revenue: {
        accounts: revenueAccounts,
        total: totalRevenue
      },
      expenses: {
        accounts: expenseAccounts,
        total: totalExpenses
      },
      netProfit
    });
  } catch (error) {
    console.error('Error generating profit and loss statement:', error);
    res.status(500).json({ error: 'Failed to generate profit and loss statement' });
  }
});

// Generate Balance Sheet
router.get('/balance-sheet', auth, async (req, res) => {
  try {
    const { asOfDate } = req.query;
    
    if (!asOfDate) {
      return res.status(400).json({ error: 'As of date is required' });
    }
    
    // Get asset accounts
    const [assetAccounts] = await db.query(`
      SELECT coa.id, coa.account_code, coa.name,
             COALESCE(SUM(le.debit_amount - le.credit_amount), 0) as balance
      FROM chart_of_accounts coa
      JOIN account_types at ON coa.account_type_id = at.id
      LEFT JOIN ledger_entries le ON coa.id = le.account_id 
                                 AND le.entry_date <= ?
      WHERE at.category = 'asset'
      GROUP BY coa.id
      ORDER BY coa.account_code
    `, [asOfDate]);
    
    // Get liability accounts
    const [liabilityAccounts] = await db.query(`
      SELECT coa.id, coa.account_code, coa.name,
             COALESCE(SUM(le.credit_amount - le.debit_amount), 0) as balance
      FROM chart_of_accounts coa
      JOIN account_types at ON coa.account_type_id = at.id
      LEFT JOIN ledger_entries le ON coa.id = le.account_id 
                                 AND le.entry_date <= ?
      WHERE at.category = 'liability'
      GROUP BY coa.id
      ORDER BY coa.account_code
    `, [asOfDate]);
    
    // Get equity accounts
    const [equityAccounts] = await db.query(`
      SELECT coa.id, coa.account_code, coa.name,
             COALESCE(SUM(le.credit_amount - le.debit_amount), 0) as balance
      FROM chart_of_accounts coa
      JOIN account_types at ON coa.account_type_id = at.id
      LEFT JOIN ledger_entries le ON coa.id = le.account_id 
                                 AND le.entry_date <= ?
      WHERE at.category = 'equity'
      GROUP BY coa.id
      ORDER BY coa.account_code
    `, [asOfDate]);
    
    // Calculate retained earnings (net profit/loss for all time up to asOfDate)
    const [retainedEarnings] = await db.query(`
      SELECT 
        (SELECT COALESCE(SUM(le.credit_amount - le.debit_amount), 0)
         FROM ledger_entries le
         JOIN chart_of_accounts coa ON le.account_id = coa.id
         JOIN account_types at ON coa.account_type_id = at.id
         WHERE at.category = 'revenue' AND le.entry_date <= ?) -
        (SELECT COALESCE(SUM(le.debit_amount - le.credit_amount), 0)
         FROM ledger_entries le
         JOIN chart_of_accounts coa ON le.account_id = coa.id
         JOIN account_types at ON coa.account_type_id = at.id
         WHERE at.category = 'expense' AND le.entry_date <= ?) as retained_earnings
    `, [asOfDate, asOfDate]);
    
    // Calculate totals
    const totalAssets = assetAccounts.reduce((sum, account) => sum + parseFloat(account.balance), 0);
    const totalLiabilities = liabilityAccounts.reduce((sum, account) => sum + parseFloat(account.balance), 0);
    const totalEquity = equityAccounts.reduce((sum, account) => sum + parseFloat(account.balance), 0) + 
                        parseFloat(retainedEarnings[0].retained_earnings);
    
    res.json({
      asOfDate,
      assets: {
        accounts: assetAccounts,
        total: totalAssets
      },
      liabilities: {
        accounts: liabilityAccounts,
        total: totalLiabilities
      },
      equity: {
        accounts: equityAccounts,
        retainedEarnings: parseFloat(retainedEarnings[0].retained_earnings),
        total: totalEquity
      },
      totalLiabilitiesAndEquity: totalLiabilities + totalEquity
    });
  } catch (error) {
    console.error('Error generating balance sheet:', error);
    res.status(500).json({ error: 'Failed to generate balance sheet' });
  }
});

// ---------------------------------------------------------------------------
// Trial Balance - every account (not just asset/liability/equity), net
// balance placed in whichever column (Debit/Credit) the balance actually
// sits on. Unlike Balance Sheet, this isn't category-aware: a liability
// account with a net debit balance still shows under Debit, exactly as a
// real trial balance would (it's a raw double-entry check, not a
// classified statement).
// ---------------------------------------------------------------------------
router.get('/trial-balance', auth, async (req, res) => {
  try {
    const { asOfDate } = req.query;
    if (!asOfDate) {
      return res.status(400).json({ error: 'As of date is required' });
    }

    const [accounts] = await db.query(`
      SELECT coa.id, coa.account_code, coa.name, at.category,
             COALESCE(SUM(le.debit_amount - le.credit_amount), 0) AS net_balance
      FROM chart_of_accounts coa
      JOIN account_types at ON coa.account_type_id = at.id
      LEFT JOIN ledger_entries le ON coa.id = le.account_id
                                 AND le.entry_date <= ?
      GROUP BY coa.id
      ORDER BY coa.account_code
    `, [asOfDate]);

    let totalDebit = 0;
    let totalCredit = 0;
    const rows = accounts
      .map((a) => {
        const net = parseFloat(a.net_balance) || 0;
        const debit = net >= 0 ? net : 0;
        const credit = net < 0 ? -net : 0;
        totalDebit += debit;
        totalCredit += credit;
        return {
          id: a.id,
          account_code: a.account_code,
          name: a.name,
          category: a.category,
          debit,
          credit
        };
      })
      // Trial balance conventionally omits accounts with no activity at all.
      .filter((a) => a.debit !== 0 || a.credit !== 0);

    res.json({
      asOfDate,
      accounts: rows,
      totalDebit,
      totalCredit,
      balanced: Math.abs(totalDebit - totalCredit) < 0.01
    });
  } catch (error) {
    console.error('Error generating trial balance:', error);
    res.status(500).json({ error: 'Failed to generate trial balance' });
  }
});

// ---------------------------------------------------------------------------
// Settlement Ledger Preview
// Source of truth: transaction tables (gsec, buyback_deals, repo_deals).
// Ledger entries are LEFT JOINed so unposted deals still appear.
// Monthly bucket uses each transaction's own value_date (not entry_date).
// Excluded: daily accruals, daily amortization, EOD interest entries.
// ---------------------------------------------------------------------------

const SETTLEMENT_EXCL_LIKE = [
  'GSec Daily Accrual%',
  'GSec Daily Amortization%',
  'GSec Coupon Settlement%',
  'Repo Daily Interest Accrual%',
  'Reverse Repo Daily Interest Accrual%',
  'Daily lending interest EOD',
  'Daily borrowing interest EOD',
];

const SETTLEMENT_CATEGORY_DEFS = [
  { key: 'gsec_buy',      label: 'G-Sec Buy' },
  { key: 'gsec_sell',     label: 'G-Sec Sell' },
  { key: 'buyback_buy',   label: 'Buyback Buy (2nd Leg)' },
  { key: 'buyback_sell',  label: 'Buyback Sell (1st Leg)' },
  { key: 'repo',          label: 'Repo' },
  { key: 'reverse_repo',  label: 'Reverse Repo' },
];

const MONTH_LABELS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function buildEmptyGroups() {
  const groups = {};
  for (const def of SETTLEMENT_CATEGORY_DEFS) {
    groups[def.key] = {
      label: def.label,
      totals: {
        debit: 0,
        credit: 0,
        count: 0,
        estimatedDebit: 0,
        estimatedCredit: 0,
        unposted: 0,
      },
      entries: [],
    };
  }
  return groups;
}

/**
 * Estimate the headline DR/CR amount that WILL be posted to ledger when this deal
 * reaches final approval. Mirrors the actual posting services:
 *  - GSec Buy/Sell  -> settlement_amount  (total of DR side = total of CR side)
 *  - Buyback Buy    -> gsec.settlement_amount
 *  - Buyback Sell   -> bd.leg1_settlement_amount
 *  - Repo / R-Repo  -> rd.principal_amount
 */
function computeEstimatedAmount(row) {
  const amt = parseFloat(row.deal_amount);
  return Number.isFinite(amt) ? amt : 0;
}

/** Default account codes used by the posting services. */
const SETTLEMENT_ACCOUNTS = {
  GSEC_TREASURY_BONDS:    '131-101-350-098-44',
  GSEC_ACCRUED_INTEREST:  '131-101-350-128-44',
  GSEC_BANK:              '131-101-410-164-44',
  REPO_REVERSE_ASSET:     '131-101-410-206-44',
  REPO_LIABILITY:         '249-101-330-308-44',
};

/**
 * Expand a single unposted deal into the journal lines that WILL be posted when
 * the deal reaches final approval. This mirrors the postFinalApproved* services.
 *
 * Returns an array of `{ account_code, account_name, estimated_debit,
 * estimated_credit, ledger_description, line_role }` objects.
 */
function expandUnpostedDeal(row, acctLabelMap) {
  const lookup = (code, fallback) => acctLabelMap[code] || fallback;
  const settlement = parseFloat(row.deal_amount) || 0;
  const accrued    = parseFloat(row.accrued_interest) || 0;
  const net        = settlement - accrued;
  const dealNo     = row.deal_number;

  // GSec Buy (and Buyback Buy 2nd leg) — 3-line compound entry.
  if (row.category === 'gsec_buy' || row.category === 'buyback_buy') {
    const prefix = row.category === 'buyback_buy' && row.buyback_deal_number
      ? `Buyback ${row.buyback_deal_number} - `
      : '';
    const lines = [
      {
        line_role: 'treasury_bonds',
        account_code: SETTLEMENT_ACCOUNTS.GSEC_TREASURY_BONDS,
        account_name: lookup(SETTLEMENT_ACCOUNTS.GSEC_TREASURY_BONDS, 'Treasury Bonds - Trading A/c'),
        estimated_debit:  net,
        estimated_credit: 0,
        ledger_description: `${prefix}GSec Purchase - Treasury Bonds - ${dealNo}`,
      },
      {
        line_role: 'accrued_interest',
        account_code: SETTLEMENT_ACCOUNTS.GSEC_ACCRUED_INTEREST,
        account_name: lookup(SETTLEMENT_ACCOUNTS.GSEC_ACCRUED_INTEREST, 'Accrude Coupon Interest Paid at Purchase - TBond Trading'),
        estimated_debit:  accrued,
        estimated_credit: 0,
        ledger_description: `${prefix}GSec Purchase - Accrued Interest - ${dealNo}`,
      },
      {
        line_role: 'bank',
        account_code: SETTLEMENT_ACCOUNTS.GSEC_BANK,
        account_name: lookup(SETTLEMENT_ACCOUNTS.GSEC_BANK, 'Seylan Bank A/C - 0860-13374197-001'),
        estimated_debit:  0,
        estimated_credit: settlement,
        ledger_description: `${prefix}GSec Purchase - Final Approval - ${dealNo}`,
      },
    ];
    return lines.filter((l) => l.estimated_debit > 0 || l.estimated_credit > 0);
  }

  // GSec Sell — simplified 2-line (DR Bank, CR Treasury Bonds). Full posting
  // logic computes capital gain/amortisation/coupon accrual which requires the
  // original buy deal lookup; we surface the headline cash leg here.
  if (row.category === 'gsec_sell' || row.category === 'buyback_sell') {
    const prefix = row.category === 'buyback_sell'
      ? `Buyback ${row.buyback_deal_number || dealNo} - `
      : '';
    const desc   = `${prefix}GSec Sale - Final Approval - ${dealNo}`;
    return [
      {
        line_role: 'bank',
        account_code: SETTLEMENT_ACCOUNTS.GSEC_BANK,
        account_name: lookup(SETTLEMENT_ACCOUNTS.GSEC_BANK, 'Seylan Bank A/C - 0860-13374197-001'),
        estimated_debit:  settlement,
        estimated_credit: 0,
        ledger_description: desc,
      },
      {
        line_role: 'treasury_bonds',
        account_code: SETTLEMENT_ACCOUNTS.GSEC_TREASURY_BONDS,
        account_name: lookup(SETTLEMENT_ACCOUNTS.GSEC_TREASURY_BONDS, 'Treasury Bonds - Trading A/c'),
        estimated_debit:  0,
        estimated_credit: settlement,
        ledger_description: desc,
      },
    ];
  }

  // Reverse Repo Purchase (Sherwood lends, asset side) — DR Reverse-Repo Asset, CR Bank.
  if (row.category === 'reverse_repo') {
    const desc = `Reverse Repo Purchase - Deal ${dealNo}`;
    return [
      {
        line_role: 'reverse_repo_asset',
        account_code: SETTLEMENT_ACCOUNTS.REPO_REVERSE_ASSET,
        account_name: lookup(SETTLEMENT_ACCOUNTS.REPO_REVERSE_ASSET, 'Reverse Repo with Banks and Other Financial Institutes'),
        estimated_debit:  settlement,
        estimated_credit: 0,
        ledger_description: desc,
      },
      {
        line_role: 'bank',
        account_code: SETTLEMENT_ACCOUNTS.GSEC_BANK,
        account_name: lookup(SETTLEMENT_ACCOUNTS.GSEC_BANK, 'Seylan Bank A/C - 0860-13374197-001'),
        estimated_debit:  0,
        estimated_credit: settlement,
        ledger_description: desc,
      },
    ];
  }

  // Repo Borrowing (Sherwood borrows) — DR Bank, CR Repo Liability.
  if (row.category === 'repo') {
    const desc = `Repo Borrowing - Deal ${dealNo}`;
    return [
      {
        line_role: 'bank',
        account_code: SETTLEMENT_ACCOUNTS.GSEC_BANK,
        account_name: lookup(SETTLEMENT_ACCOUNTS.GSEC_BANK, 'Seylan Bank A/C - 0860-13374197-001'),
        estimated_debit:  settlement,
        estimated_credit: 0,
        ledger_description: desc,
      },
      {
        line_role: 'repo_liability',
        account_code: SETTLEMENT_ACCOUNTS.REPO_LIABILITY,
        account_name: lookup(SETTLEMENT_ACCOUNTS.REPO_LIABILITY, 'Repo with Banks and Other Financial Institutes'),
        estimated_debit:  0,
        estimated_credit: settlement,
        ledger_description: desc,
      },
    ];
  }

  return [];
}

router.get('/settlement-preview', auth, async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || 2026;
    const monthsRaw = (req.query.months || '4,5').toString();
    const months = monthsRaw
      .split(',')
      .map((m) => parseInt(m.trim(), 10))
      .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);

    if (months.length === 0) {
      return res.status(400).json({ error: 'months must include at least one valid month (1-12)' });
    }

    const mp = months.map(() => '?').join(', ');

    // Exclusion clause applied in LEFT JOIN ON to avoid filtering out unposted rows.
    const exclOn = SETTLEMENT_EXCL_LIKE.map(() => `le.description NOT LIKE ?`).join(' AND ');

    // Common per-deal columns we surface for the "estimated" calc on unposted rows.
    // For gsec: settlement_amount = total DR = total CR (net of bonds + accrued vs. bank).
    const [gsecBuyRows] = await db.query(`
      SELECT
        'gsec_buy'                  AS category,
        g.deal_number,
        g.transaction_type,
        DATE(g.value_date)          AS transaction_date,
        MONTH(g.value_date)         AS month_num,
        g.status                    AS deal_status,
        g.settlement_amount         AS deal_amount,
        g.accrued_interest          AS accrued_interest,
        (g.settlement_amount - IFNULL(g.accrued_interest, 0)) AS net_principal,
        g.counterparty_id,
        le.id                       AS ledger_id,
        IFNULL(le.debit_amount,  0) AS debit_amount,
        IFNULL(le.credit_amount, 0) AS credit_amount,
        le.description              AS ledger_description,
        ca.account_code,
        ca.name                     AS account_name
      FROM gsec g
      LEFT JOIN ledger_entries le
        ON  le.deal_number COLLATE utf8mb4_unicode_ci = g.deal_number COLLATE utf8mb4_unicode_ci
        AND ${exclOn}
      LEFT JOIN chart_of_accounts ca ON ca.id = le.account_id
      WHERE g.transaction_type = 'Buy'
        AND g.buyback_deal_id IS NULL
        AND g.status NOT IN ('cancelled', 'rejected')
        AND YEAR(g.value_date)  = ?
        AND MONTH(g.value_date) IN (${mp})
      ORDER BY g.value_date, g.deal_number, le.id
    `, [...SETTLEMENT_EXCL_LIKE, year, ...months]);

    const [gsecSellRows] = await db.query(`
      SELECT
        'gsec_sell'                 AS category,
        g.deal_number,
        g.transaction_type,
        DATE(g.value_date)          AS transaction_date,
        MONTH(g.value_date)         AS month_num,
        g.status                    AS deal_status,
        g.settlement_amount         AS deal_amount,
        g.accrued_interest          AS accrued_interest,
        (g.settlement_amount - IFNULL(g.accrued_interest, 0)) AS net_principal,
        g.counterparty_id,
        le.id                       AS ledger_id,
        IFNULL(le.debit_amount,  0) AS debit_amount,
        IFNULL(le.credit_amount, 0) AS credit_amount,
        le.description              AS ledger_description,
        ca.account_code,
        ca.name                     AS account_name
      FROM gsec g
      LEFT JOIN ledger_entries le
        ON  le.deal_number COLLATE utf8mb4_unicode_ci = g.deal_number COLLATE utf8mb4_unicode_ci
        AND ${exclOn}
      LEFT JOIN chart_of_accounts ca ON ca.id = le.account_id
      WHERE g.transaction_type = 'Sell'
        AND g.buyback_deal_id IS NULL
        AND g.status NOT IN ('cancelled', 'rejected')
        AND YEAR(g.value_date)  = ?
        AND MONTH(g.value_date) IN (${mp})
      ORDER BY g.value_date, g.deal_number, le.id
    `, [...SETTLEMENT_EXCL_LIKE, year, ...months]);

    const [bbBuyRows] = await db.query(`
      SELECT
        'buyback_buy'               AS category,
        g.deal_number,
        g.transaction_type,
        DATE(g.value_date)          AS transaction_date,
        MONTH(g.value_date)         AS month_num,
        g.status                    AS deal_status,
        g.settlement_amount         AS deal_amount,
        g.accrued_interest          AS accrued_interest,
        (g.settlement_amount - IFNULL(g.accrued_interest, 0)) AS net_principal,
        g.counterparty_id,
        bd.deal_number              AS buyback_deal_number,
        le.id                       AS ledger_id,
        IFNULL(le.debit_amount,  0) AS debit_amount,
        IFNULL(le.credit_amount, 0) AS credit_amount,
        le.description              AS ledger_description,
        ca.account_code,
        ca.name                     AS account_name
      FROM gsec g
      JOIN buyback_deals bd ON bd.id = g.buyback_deal_id
      LEFT JOIN ledger_entries le
        ON  le.deal_number COLLATE utf8mb4_unicode_ci = g.deal_number COLLATE utf8mb4_unicode_ci
        AND ${exclOn}
      LEFT JOIN chart_of_accounts ca ON ca.id = le.account_id
      WHERE g.transaction_type = 'Buy'
        AND g.buyback_deal_id IS NOT NULL
        AND g.status NOT IN ('cancelled', 'rejected')
        AND YEAR(g.value_date)  = ?
        AND MONTH(g.value_date) IN (${mp})
      ORDER BY g.value_date, g.deal_number, le.id
    `, [...SETTLEMENT_EXCL_LIKE, year, ...months]);

    // Fallback buyback BUY rows for deals that do not have linked gsec buy rows.
    // This captures patterns like BB20260402002 (leg1=Buy, leg2=Sell).
    const [bbBuyFallbackRows] = await db.query(`
      SELECT
        'buyback_buy'                       AS category,
        CONCAT(bd.deal_number, '/BB-L1')    AS deal_number,
        'Buy'                               AS transaction_type,
        DATE(bd.leg1_value_date)            AS transaction_date,
        MONTH(bd.leg1_value_date)           AS month_num,
        bd.deal_status                      AS deal_status,
        bd.leg1_settlement_amount           AS deal_amount,
        bd.leg1_accrued_interest            AS accrued_interest,
        (bd.leg1_settlement_amount - IFNULL(bd.leg1_accrued_interest, 0)) AS net_principal,
        bd.leg1_counterparty                AS counterparty_id,
        bd.deal_number                      AS buyback_deal_number,
        le.id                               AS ledger_id,
        IFNULL(le.debit_amount,  0)         AS debit_amount,
        IFNULL(le.credit_amount, 0)         AS credit_amount,
        le.description                      AS ledger_description,
        ca.account_code,
        ca.name                             AS account_name
      FROM buyback_deals bd
      LEFT JOIN ledger_entries le
        ON  le.deal_number COLLATE utf8mb4_unicode_ci LIKE CONCAT(bd.deal_number COLLATE utf8mb4_unicode_ci, '/BB-L1/%')
        AND ${exclOn}
      LEFT JOIN chart_of_accounts ca ON ca.id = le.account_id
      WHERE bd.deal_status NOT IN ('Rejected', 'Draft')
        AND bd.leg1_transaction_type = 'Buy'
        AND YEAR(bd.leg1_value_date) = ?
        AND MONTH(bd.leg1_value_date) IN (${mp})
        AND NOT EXISTS (
          SELECT 1 FROM gsec gx
          WHERE gx.buyback_deal_id = bd.id
            AND gx.transaction_type = 'Buy'
            AND gx.status NOT IN ('cancelled', 'rejected')
        )

      UNION ALL

      SELECT
        'buyback_buy'                       AS category,
        CONCAT(bd.deal_number, '/BB-L2')    AS deal_number,
        'Buy'                               AS transaction_type,
        DATE(bd.leg2_value_date)            AS transaction_date,
        MONTH(bd.leg2_value_date)           AS month_num,
        bd.deal_status                      AS deal_status,
        bd.leg2_settlement_amount           AS deal_amount,
        bd.leg2_accrued_interest            AS accrued_interest,
        (bd.leg2_settlement_amount - IFNULL(bd.leg2_accrued_interest, 0)) AS net_principal,
        bd.leg2_counterparty                AS counterparty_id,
        bd.deal_number                      AS buyback_deal_number,
        le.id                               AS ledger_id,
        IFNULL(le.debit_amount,  0)         AS debit_amount,
        IFNULL(le.credit_amount, 0)         AS credit_amount,
        le.description                      AS ledger_description,
        ca.account_code,
        ca.name                             AS account_name
      FROM buyback_deals bd
      LEFT JOIN ledger_entries le
        ON  le.deal_number COLLATE utf8mb4_unicode_ci LIKE CONCAT(bd.deal_number COLLATE utf8mb4_unicode_ci, '/BB-L2/%')
        AND ${exclOn}
      LEFT JOIN chart_of_accounts ca ON ca.id = le.account_id
      WHERE bd.deal_status NOT IN ('Rejected', 'Draft')
        AND bd.leg2_transaction_type = 'Buy'
        AND YEAR(bd.leg2_value_date) = ?
        AND MONTH(bd.leg2_value_date) IN (${mp})
        AND NOT EXISTS (
          SELECT 1 FROM gsec gx
          WHERE gx.buyback_deal_id = bd.id
            AND gx.transaction_type = 'Buy'
            AND gx.status NOT IN ('cancelled', 'rejected')
        )
    `, [
      ...SETTLEMENT_EXCL_LIKE, year, ...months,
      ...SETTLEMENT_EXCL_LIKE, year, ...months,
    ]);

    // Include BUYBACK SELL for whichever leg is Sell (leg1 or leg2).
    const [bbSellRows] = await db.query(`
      SELECT
        'buyback_sell'                      AS category,
        CONCAT(bd.deal_number, '/BB-L1')    AS deal_number,
        'Sell'                              AS transaction_type,
        DATE(bd.leg1_value_date)            AS transaction_date,
        MONTH(bd.leg1_value_date)           AS month_num,
        bd.deal_status                      AS deal_status,
        bd.leg1_settlement_amount           AS deal_amount,
        bd.leg1_accrued_interest            AS accrued_interest,
        (bd.leg1_settlement_amount - IFNULL(bd.leg1_accrued_interest, 0)) AS net_principal,
        bd.leg1_counterparty                AS counterparty_id,
        bd.deal_number                      AS buyback_deal_number,
        le.id                               AS ledger_id,
        IFNULL(le.debit_amount,  0)         AS debit_amount,
        IFNULL(le.credit_amount, 0)         AS credit_amount,
        le.description                      AS ledger_description,
        ca.account_code,
        ca.name                             AS account_name
      FROM buyback_deals bd
      LEFT JOIN ledger_entries le
        ON  le.deal_number COLLATE utf8mb4_unicode_ci LIKE CONCAT(bd.deal_number COLLATE utf8mb4_unicode_ci, '/BB-L1/%')
        AND ${exclOn}
      LEFT JOIN chart_of_accounts ca ON ca.id = le.account_id
      WHERE bd.deal_status NOT IN ('Rejected', 'Draft')
        AND bd.leg1_transaction_type = 'Sell'
        AND YEAR(bd.leg1_value_date) = ?
        AND MONTH(bd.leg1_value_date) IN (${mp})

      UNION ALL

      SELECT
        'buyback_sell'                      AS category,
        CONCAT(bd.deal_number, '/BB-L2')    AS deal_number,
        'Sell'                              AS transaction_type,
        DATE(bd.leg2_value_date)            AS transaction_date,
        MONTH(bd.leg2_value_date)           AS month_num,
        bd.deal_status                      AS deal_status,
        bd.leg2_settlement_amount           AS deal_amount,
        bd.leg2_accrued_interest            AS accrued_interest,
        (bd.leg2_settlement_amount - IFNULL(bd.leg2_accrued_interest, 0)) AS net_principal,
        bd.leg2_counterparty                AS counterparty_id,
        bd.deal_number                      AS buyback_deal_number,
        le.id                               AS ledger_id,
        IFNULL(le.debit_amount,  0)         AS debit_amount,
        IFNULL(le.credit_amount, 0)         AS credit_amount,
        le.description                      AS ledger_description,
        ca.account_code,
        ca.name                             AS account_name
      FROM buyback_deals bd
      LEFT JOIN ledger_entries le
        ON  le.deal_number COLLATE utf8mb4_unicode_ci LIKE CONCAT(bd.deal_number COLLATE utf8mb4_unicode_ci, '/BB-L2/%')
        AND ${exclOn}
      LEFT JOIN chart_of_accounts ca ON ca.id = le.account_id
      WHERE bd.deal_status NOT IN ('Rejected', 'Draft')
        AND bd.leg2_transaction_type = 'Sell'
        AND YEAR(bd.leg2_value_date) = ?
        AND MONTH(bd.leg2_value_date) IN (${mp})
    `, [
      ...SETTLEMENT_EXCL_LIKE, year, ...months,
      ...SETTLEMENT_EXCL_LIKE, year, ...months,
    ]);

    // ── 5. Repo / Reverse Repo – filtered by value_date ─────────────────────
    // Ledger entries use deal_number = repo_deals.deal_number
    const repoExcl = [
      'Repo Daily Interest Accrual%',
      'Reverse Repo Daily Interest Accrual%',
      'Repo Borrowing (Backfill)%',
      // Legacy description from before the Repo/Reverse Repo label swap.
      'Reverse Repo Borrowing (Backfill)%',
      'Daily lending interest EOD',
      'Daily borrowing interest EOD',
    ];
    const repoExclOn = repoExcl.map(() => `le.description NOT LIKE ?`).join(' AND ');

    const [repoRows] = await db.query(`
      SELECT
        CASE WHEN rd.deal_type = 'Repo' THEN 'repo' ELSE 'reverse_repo' END AS category,
        rd.deal_number              AS deal_number,
        rd.deal_type                AS transaction_type,
        DATE(rd.value_date)         AS transaction_date,
        MONTH(rd.value_date)        AS month_num,
        rd.approval_status          AS deal_status,
        rd.principal_amount         AS deal_amount,
        0                           AS accrued_interest,
        rd.principal_amount         AS net_principal,
        NULL                        AS counterparty_id,
        le.id                       AS ledger_id,
        IFNULL(le.debit_amount,  0) AS debit_amount,
        IFNULL(le.credit_amount, 0) AS credit_amount,
        le.description              AS ledger_description,
        ca.account_code,
        ca.name                     AS account_name
      FROM repo_deals rd
      LEFT JOIN ledger_entries le
        ON  le.deal_number COLLATE utf8mb4_unicode_ci = rd.deal_number COLLATE utf8mb4_unicode_ci
        AND ${repoExclOn}
      LEFT JOIN chart_of_accounts ca ON ca.id = le.account_id
      WHERE rd.approval_status NOT IN ('Rejected', 'Cancelled')
        AND YEAR(rd.value_date)  = ?
        AND MONTH(rd.value_date) IN (${mp})
      ORDER BY rd.value_date, rd.id, le.id
    `, [...repoExcl, year, ...months]);

    // ── Aggregate into month buckets ─────────────────────────────────────────
    const allRows = [
      ...gsecBuyRows,
      ...gsecSellRows,
      ...bbBuyRows,
      ...bbBuyFallbackRows,
      ...bbSellRows,
      ...repoRows,
    ];

    // Fetch friendly names for the standard settlement accounts used in
    // expanded unposted entries.
    const stdAccountCodes = Object.values(SETTLEMENT_ACCOUNTS);
    const [stdAccountRows] = await db.query(
      `SELECT account_code, name FROM chart_of_accounts WHERE account_code IN (${stdAccountCodes.map(() => '?').join(',')})`,
      stdAccountCodes
    );
    const acctLabelMap = Object.fromEntries(stdAccountRows.map((r) => [r.account_code, r.name]));

    const monthBuckets = new Map();
    for (const m of months) {
      monthBuckets.set(m, {
        month: m,
        label: `${MONTH_LABELS[m]} ${year}`,
        totals: {
          debit: 0,
          credit: 0,
          count: 0,
          estimatedDebit: 0,
          estimatedCredit: 0,
          unposted: 0,
        },
        groups: buildEmptyGroups(),
      });
    }

    for (const row of allRows) {
      const bucket = monthBuckets.get(row.month_num);
      if (!bucket) continue;

      const { category } = row;
      const isPosted = row.ledger_id !== null;
      const group = bucket.groups[category] || bucket.groups.gsec_buy;

      if (isPosted) {
        const debit  = parseFloat(row.debit_amount)  || 0;
        const credit = parseFloat(row.credit_amount) || 0;
        group.entries.push({ ...row, posted: true });
        group.totals.debit  += debit;
        group.totals.credit += credit;
        group.totals.count  += 1;
        bucket.totals.debit  += debit;
        bucket.totals.credit += credit;
        bucket.totals.count  += 1;
      } else {
        // Expand each unposted deal into the journal lines that WILL be written
        // when the deal reaches final approval. Mirrors postFinalApproved*.
        const lines = expandUnpostedDeal(row, acctLabelMap);
        if (lines.length === 0) {
          // Fallback: single headline row (e.g. for unmapped categories).
          const estAmount = computeEstimatedAmount(row);
          group.entries.push({
            ...row,
            posted: false,
            estimated_debit:  estAmount,
            estimated_credit: estAmount,
          });
          group.totals.estimatedDebit  += estAmount;
          group.totals.estimatedCredit += estAmount;
        } else {
          for (const line of lines) {
            group.entries.push({
              ...row,
              ...line,
              posted: false,
            });
            group.totals.estimatedDebit  += line.estimated_debit;
            group.totals.estimatedCredit += line.estimated_credit;
          }
        }

        // Each deal counts as ONE unposted regardless of how many lines.
        group.totals.unposted   += 1;
        bucket.totals.unposted  += 1;
        bucket.totals.estimatedDebit  += parseFloat(row.deal_amount) || 0;
        bucket.totals.estimatedCredit += parseFloat(row.deal_amount) || 0;
      }
    }

    res.json({
      year,
      months: Array.from(monthBuckets.values()).sort((a, b) => a.month - b.month),
      excludedPatterns: SETTLEMENT_EXCL_LIKE,
      categories: SETTLEMENT_CATEGORY_DEFS,
    });
  } catch (error) {
    console.error('Error fetching settlement preview:', error);
    res.status(500).json({ error: 'Failed to fetch settlement preview' });
  }
});

module.exports = router;
