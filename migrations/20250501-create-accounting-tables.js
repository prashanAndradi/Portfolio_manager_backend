const db = require('../config/db');

async function createAccountingTables() {
  try {
    console.log('Creating accounting tables...');

    // Create account_types table
    await db.query(`
      CREATE TABLE IF NOT EXISTS account_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE,
        category ENUM('asset', 'liability', 'equity', 'revenue', 'expense') NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Account types table created successfully');

    // Insert default account types if table is empty
    const [accountTypesCount] = await db.query('SELECT COUNT(*) as count FROM account_types');
    if (accountTypesCount[0].count === 0) {
      await db.query(`
        INSERT INTO account_types (name, category, description) VALUES
        ('Cash and Cash Equivalents', 'asset', 'Cash and highly liquid investments'),
        ('Investments', 'asset', 'Long-term and short-term investments'),
        ('Accounts Receivable', 'asset', 'Amounts owed to the company'),
        ('Fixed Assets', 'asset', 'Long-term tangible assets'),
        ('Other Assets', 'asset', 'Miscellaneous assets'),
        ('Accounts Payable', 'liability', 'Amounts owed by the company'),
        ('Loans Payable', 'liability', 'Short and long-term loans'),
        ('Other Liabilities', 'liability', 'Miscellaneous liabilities'),
        ('Capital', 'equity', 'Owner capital'),
        ('Retained Earnings', 'equity', 'Accumulated profits'),
        ('Investment Income', 'revenue', 'Income from investments'),
        ('Interest Income', 'revenue', 'Interest earned'),
        ('Fee Income', 'revenue', 'Fees collected'),
        ('Other Income', 'revenue', 'Miscellaneous income'),
        ('Operating Expenses', 'expense', 'Day-to-day operational costs'),
        ('Interest Expenses', 'expense', 'Interest paid'),
        ('Transaction Costs', 'expense', 'Costs related to transactions'),
        ('Other Expenses', 'expense', 'Miscellaneous expenses')
      `);
      console.log('Default account types created');
    }

    // Create chart_of_accounts table
    await db.query(`
      CREATE TABLE IF NOT EXISTS chart_of_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_code VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        account_type_id INT NOT NULL,
        parent_account_id INT,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (account_type_id) REFERENCES account_types(id),
        FOREIGN KEY (parent_account_id) REFERENCES chart_of_accounts(id) ON DELETE SET NULL
      )
    `);
    console.log('Chart of accounts table created successfully');

    // Insert default accounts if table is empty
    const [accountsCount] = await db.query('SELECT COUNT(*) as count FROM chart_of_accounts');
    if (accountsCount[0].count === 0) {
      // Get account type IDs
      const [accountTypes] = await db.query('SELECT id, name FROM account_types');
      const accountTypeMap = {};
      accountTypes.forEach(type => {
        accountTypeMap[type.name] = type.id;
      });

      // Insert parent accounts first
      await db.query(`
        INSERT INTO chart_of_accounts (account_code, name, account_type_id, description) VALUES
        ('1000', 'Cash and Bank', ${accountTypeMap['Cash and Cash Equivalents']}, 'Cash and bank accounts'),
        ('2000', 'Investments', ${accountTypeMap['Investments']}, 'Investment accounts'),
        ('3000', 'Receivables', ${accountTypeMap['Accounts Receivable']}, 'Amounts to be received'),
        ('4000', 'Fixed Assets', ${accountTypeMap['Fixed Assets']}, 'Long-term assets'),
        ('5000', 'Payables', ${accountTypeMap['Accounts Payable']}, 'Amounts to be paid'),
        ('6000', 'Loans', ${accountTypeMap['Loans Payable']}, 'Borrowed funds'),
        ('7000', 'Capital and Reserves', ${accountTypeMap['Capital']}, 'Owner funds'),
        ('8000', 'Income', ${accountTypeMap['Investment Income']}, 'Revenue accounts'),
        ('9000', 'Expenses', ${accountTypeMap['Operating Expenses']}, 'Expense accounts')
      `);
      console.log('Default parent accounts created');

      // Get parent account IDs
      const [parentAccounts] = await db.query('SELECT id, account_code, name FROM chart_of_accounts');
      const parentAccountMap = {};
      parentAccounts.forEach(account => {
        parentAccountMap[account.account_code] = account.id;
      });

      // Insert child accounts
      await db.query(`
        INSERT INTO chart_of_accounts (account_code, name, account_type_id, parent_account_id, description) VALUES
        ('1001', 'Cash', ${accountTypeMap['Cash and Cash Equivalents']}, ${parentAccountMap['1000']}, 'Physical cash'),
        ('1002', 'Bank Current Account', ${accountTypeMap['Cash and Cash Equivalents']}, ${parentAccountMap['1000']}, 'Bank current account'),
        ('1003', 'Bank Savings Account', ${accountTypeMap['Cash and Cash Equivalents']}, ${parentAccountMap['1000']}, 'Bank savings account'),
        ('2001', 'Equity Investments', ${accountTypeMap['Investments']}, ${parentAccountMap['2000']}, 'Investments in stocks'),
        ('2002', 'Fixed Income Investments', ${accountTypeMap['Investments']}, ${parentAccountMap['2000']}, 'Bonds and other fixed income'),
        ('2003', 'Other Investments', ${accountTypeMap['Investments']}, ${parentAccountMap['2000']}, 'Other investment types'),
        ('8001', 'Interest Income', ${accountTypeMap['Interest Income']}, ${parentAccountMap['8000']}, 'Income from interest'),
        ('8002', 'Dividend Income', ${accountTypeMap['Investment Income']}, ${parentAccountMap['8000']}, 'Income from dividends'),
        ('8003', 'Capital Gains', ${accountTypeMap['Investment Income']}, ${parentAccountMap['8000']}, 'Gains from asset sales'),
        ('9001', 'Brokerage Fees', ${accountTypeMap['Transaction Costs']}, ${parentAccountMap['9000']}, 'Fees paid to brokers'),
        ('9002', 'Bank Charges', ${accountTypeMap['Operating Expenses']}, ${parentAccountMap['9000']}, 'Fees charged by banks'),
        ('9003', 'Interest Expense', ${accountTypeMap['Interest Expenses']}, ${parentAccountMap['9000']}, 'Interest paid on loans')
      `);
      console.log('Default child accounts created');
    }

    // Create ledger_entries table
    await db.query(`
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transaction_id INT,
        account_id INT NOT NULL,
        entry_date DATE NOT NULL,
        debit_amount DECIMAL(15, 2) DEFAULT 0.00,
        credit_amount DECIMAL(15, 2) DEFAULT 0.00,
        currency VARCHAR(10) DEFAULT 'LKR',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
        FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
      )
    `);
    console.log('Ledger entries table created successfully');

    console.log('All accounting tables created successfully');
  } catch (error) {
    console.error('Error creating accounting tables:', error);
  } finally {
    process.exit();
  }
}

// Run the migration
createAccountingTables();
