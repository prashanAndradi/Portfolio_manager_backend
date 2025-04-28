const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

async function checkDatabaseTables() {
  let connection;

  try {
    console.log('Checking database structure...');
    
    // Create a connection
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306
    });
    
    // Check if tables exist
    const [tables] = await connection.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = ? 
      AND table_name IN ('accounts', 'transaction_types', 'transactions')
    `, [process.env.DB_NAME]);
    
    console.log('Tables found:', tables.map(t => t.TABLE_NAME || t.table_name));
    
    // Check for missing tables
    const tableNames = tables.map(t => t.TABLE_NAME || t.table_name);
    const requiredTables = ['accounts', 'transaction_types', 'transactions'];
    const missingTables = requiredTables.filter(t => !tableNames.includes(t));
    
    if (missingTables.length > 0) {
      console.error(`Missing tables: ${missingTables.join(', ')}`);
      console.log('Reinitializing database...');
      
      // Drop and recreate all tables to ensure proper structure
      const createTablesScript = `
        -- Drop tables if they exist
        DROP TABLE IF EXISTS transactions;
        DROP TABLE IF EXISTS transaction_types;
        DROP TABLE IF EXISTS accounts;
        
        -- Create accounts table
        CREATE TABLE accounts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );
        
        -- Create transaction_types table
        CREATE TABLE transaction_types (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        -- Create transactions table
        CREATE TABLE transactions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          source_account_id INT NOT NULL,
          transaction_type_id INT NOT NULL,
          amount DECIMAL(15, 2) NOT NULL,
          date DATE NOT NULL,
          description TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (source_account_id) REFERENCES accounts(id),
          FOREIGN KEY (transaction_type_id) REFERENCES transaction_types(id)
        );
        
        -- Insert sample accounts
        INSERT INTO accounts (name, balance) VALUES
          ('Savings Account', 5000.00),
          ('Fixed Deposit #1', 10000.00),
          ('Investment Account', 7500.00);
        
        -- Insert transaction types
        INSERT INTO transaction_types (name) VALUES
          ('Deposit'),
          ('Withdrawal'),
          ('Transfer'),
          ('Bill Payment'),
          ('Investment');
      `;
      
      // Split SQL statements
      const sqlStatements = createTablesScript
        .split(';')
        .filter(statement => statement.trim() !== '');
      
      // Execute each SQL statement
      for (const statement of sqlStatements) {
        await connection.query(statement + ';');
      }
      
      console.log('Database structure fixed. Tables have been recreated.');
    } else {
      // Check transactions table structure
      console.log('Checking transactions table structure...');
      const [columns] = await connection.query(`
        SHOW COLUMNS FROM transactions
      `);
      
      console.log('Transaction table columns:', columns.map(c => c.Field));
      
      // Check for foreign key constraints
      console.log('Checking foreign key constraints...');
      const [constraints] = await connection.query(`
        SELECT * 
        FROM information_schema.table_constraints 
        WHERE constraint_schema = ? 
        AND table_name = 'transactions' 
        AND constraint_type = 'FOREIGN KEY'
      `, [process.env.DB_NAME]);
      
      console.log('Foreign key constraints:', constraints.length);
      
      if (constraints.length < 2) {
        console.warn('Warning: The transactions table may be missing proper foreign key constraints.');
      }
    }
    
    console.log('Database structure check completed.');
  } catch (error) {
    console.error('Error checking database structure:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run the check
checkDatabaseTables(); 