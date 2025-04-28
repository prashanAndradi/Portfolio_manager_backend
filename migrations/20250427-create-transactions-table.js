const db = require('../config/database');

async function createTransactionsTable() {
  try {
    // Create transactions table
    await db.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        date DATE NOT NULL,
        trade_date DATE,
        value_date DATE,
        source_account_id INT,
        security_id INT,
        amount DECIMAL(15, 2) NOT NULL,
        interest_rate DECIMAL(10, 4),
        counterparty_id INT,
        transaction_type_id INT,
        settlement_mode VARCHAR(50),
        price DECIMAL(15, 4),
        yield DECIMAL(10, 4),
        description TEXT,
        portfolio VARCHAR(50),
        strategy VARCHAR(100),
        currency VARCHAR(10) DEFAULT 'LKR',
        transaction_code VARCHAR(50),
        commission DECIMAL(15, 2),
        brokerage DECIMAL(15, 2),
        remarks TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('Transactions table created successfully');
    
    // Create accounts table if it doesn't exist (for foreign key reference)
    await db.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        account_number VARCHAR(50) UNIQUE,
        balance DECIMAL(15, 2) DEFAULT 0.00,
        currency VARCHAR(10) DEFAULT 'LKR',
        account_type VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Accounts table created successfully');
    
    // Insert sample data if tables are empty
    const [transactionCount] = await db.query('SELECT COUNT(*) as count FROM transactions');
    if (transactionCount[0].count === 0) {
      console.log('Inserting sample transactions...');
      
      // Insert sample accounts if needed
      const [accountCount] = await db.query('SELECT COUNT(*) as count FROM accounts');
      if (accountCount[0].count === 0) {
        await db.query(`
          INSERT INTO accounts (name, account_number, balance, account_type) VALUES
          ('Savings Account', 'SA-001', 10000.00, 'savings'),
          ('Current Account', 'CA-001', 25000.00, 'current'),
          ('Fixed Deposit', 'FD-001', 100000.00, 'fixed')
        `);
        console.log('Sample accounts created');
      }
      
      // Insert sample transactions
      await db.query(`
        INSERT INTO transactions 
        (date, trade_date, value_date, source_account_id, amount, currency, description, status) 
        VALUES
        (CURDATE(), CURDATE(), CURDATE(), 1, 1000.00, 'LKR', 'Initial deposit', 'approved'),
        (CURDATE(), CURDATE(), CURDATE(), 2, -500.00, 'LKR', 'Withdrawal', 'approved'),
        (CURDATE(), CURDATE(), CURDATE(), 1, 250.00, 'LKR', 'Interest payment', 'pending')
      `);
      console.log('Sample transactions created');
    }
    
  } catch (error) {
    console.error('Error creating transactions table:', error);
  }
}

// Run the migration
createTransactionsTable();
