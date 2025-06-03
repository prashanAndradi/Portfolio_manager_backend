const db = require('../config/db');

class Accounting {
  // Create ledger entries for a transaction
  static async createLedgerEntriesForTransaction(transaction, connection) {
    try {
      const conn = connection || db;
      
      // Determine transaction type to set appropriate accounts
      const transactionType = transaction.transaction_type_id || transaction.category || 'general';
      const amount = parseFloat(transaction.amount);
      const date = transaction.date || new Date().toISOString().split('T')[0];
      const currency = transaction.currency || 'LKR';
      
      // Get default accounts based on transaction type
      const [accountTypes] = await conn.query(`
        SELECT id FROM account_types WHERE category IN ('asset', 'liability', 'revenue', 'expense')
      `);
      
      if (accountTypes.length === 0) {
        throw new Error('Account types not found. Please run the accounting migration first.');
      }
      
      // Get appropriate accounts based on transaction type
      let sourceAccountId, destinationAccountId;
      
      // For positive amounts (income/deposit)
      if (amount >= 0) {
        // Find cash/bank account (asset)
        const [cashAccounts] = await conn.query(`
          SELECT id FROM chart_of_accounts 
          WHERE account_code LIKE '1%' AND is_active = TRUE
          LIMIT 1
        `);
        
        // Find income account based on transaction type
        const [incomeAccounts] = await conn.query(`
          SELECT id FROM chart_of_accounts 
          WHERE account_code LIKE '8%' AND is_active = TRUE
          LIMIT 1
        `);
        
        if (cashAccounts.length === 0 || incomeAccounts.length === 0) {
          throw new Error('Required accounts not found. Please set up chart of accounts first.');
        }
        
        sourceAccountId = incomeAccounts[0].id;
        destinationAccountId = cashAccounts[0].id;
      } 
      // For negative amounts (expense/withdrawal)
      else {
        // Find cash/bank account (asset)
        const [cashAccounts] = await conn.query(`
          SELECT id FROM chart_of_accounts 
          WHERE account_code LIKE '1%' AND is_active = TRUE
          LIMIT 1
        `);
        
        // Find expense account based on transaction type
        const [expenseAccounts] = await conn.query(`
          SELECT id FROM chart_of_accounts 
          WHERE account_code LIKE '9%' AND is_active = TRUE
          LIMIT 1
        `);
        
        if (cashAccounts.length === 0 || expenseAccounts.length === 0) {
          throw new Error('Required accounts not found. Please set up chart of accounts first.');
        }
        
        sourceAccountId = cashAccounts[0].id;
        destinationAccountId = expenseAccounts[0].id;
      }
      
      // Create ledger entries (double-entry accounting)
      const absAmount = Math.abs(amount);
      const description = transaction.description || `Transaction #${transaction.id}`;
      
      // For positive amounts: Debit Asset (Cash), Credit Revenue
      // For negative amounts: Debit Expense, Credit Asset (Cash)
      if (amount >= 0) {
        // Debit entry (Asset increase)
        await conn.query(`
          INSERT INTO ledger_entries 
          (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          transaction.deal_number,
          destinationAccountId,
          date,
          absAmount,
          0,
          currency,
          `${description} - Cash/Bank Increase`
        ]);
        
        // Credit entry (Revenue)
        await conn.query(`
          INSERT INTO ledger_entries 
          (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          transaction.deal_number,
          sourceAccountId,
          date,
          0,
          absAmount,
          currency,
          `${description} - Revenue Recognition`
        ]);
      } else {
        // Debit entry (Expense)
        await conn.query(`
          INSERT INTO ledger_entries 
          (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          transaction.deal_number,
          destinationAccountId,
          date,
          absAmount,
          0,
          currency,
          `${description} - Expense Recognition`
        ]);
        
        // Credit entry (Asset decrease)
        await conn.query(`
          INSERT INTO ledger_entries 
          (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          transaction.deal_number,
          sourceAccountId,
          date,
          0,
          absAmount,
          currency,
          `${description} - Cash/Bank Decrease`
        ]);
      }
      
      return true;
    } catch (error) {
      console.error('Error creating ledger entries:', error);
      throw error;
    }
  }
  
  // Delete ledger entries for a transaction
  static async deleteLedgerEntriesForTransaction(transactionId, connection) {
    try {
      const conn = connection || db;
      
      await conn.query(
        'DELETE FROM ledger_entries WHERE transaction_id = ?',
        [transactionId]
      );
      
      return true;
    } catch (error) {
      console.error('Error deleting ledger entries:', error);
      throw error;
    }
  }
  
  // Get general ledger entries
  static async getGeneralLedger(filters = {}) {
    try {
      let query = `
        SELECT le.*, 
               coa.account_code, coa.name as account_name,
               at.category as account_category,
               t.transaction_code, t.description as transaction_description
        FROM ledger_entries le
        JOIN chart_of_accounts coa ON le.account_id = coa.id
        JOIN account_types at ON coa.account_type_id = at.id
        LEFT JOIN transactions t ON le.transaction_id = t.id
        WHERE 1=1
      `;
      
      const params = [];
      
      if (filters.startDate) {
        query += ` AND le.entry_date >= ?`;
        params.push(filters.startDate);
      }
      
      if (filters.endDate) {
        query += ` AND le.entry_date <= ?`;
        params.push(filters.endDate);
      }
      
      if (filters.accountId) {
        query += ` AND le.account_id = ?`;
        params.push(filters.accountId);
      }
      
      if (filters.transactionId) {
        query += ` AND le.transaction_id = ?`;
        params.push(filters.transactionId);
      }
      
      query += ` ORDER BY le.entry_date DESC, le.id DESC`;
      
      if (filters.limit) {
        query += ` LIMIT ?`;
        params.push(parseInt(filters.limit));
        
        if (filters.offset) {
          query += ` OFFSET ?`;
          params.push(parseInt(filters.offset));
        }
      }
      
      const [rows] = await db.query(query, params);
      return rows;
    } catch (error) {
      throw error;
    }
  }
  
  // Generate Profit and Loss statement
  static async getProfitAndLoss(startDate, endDate) {
    try {
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
      
      return {
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
      };
    } catch (error) {
      throw error;
    }
  }
  
  // Generate Balance Sheet
  static async getBalanceSheet(asOfDate) {
    try {
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
      
      return {
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
      };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = Accounting;
