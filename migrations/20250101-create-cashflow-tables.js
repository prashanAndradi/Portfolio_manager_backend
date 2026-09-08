const db = require('../config/database');

async function createCashflowTables() {
  try {
    console.log('Creating cashflow tables...');

    // Create cashflow_categories table
    await db.query(`
      CREATE TABLE IF NOT EXISTS cashflow_categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type ENUM('operating', 'investing', 'financing') NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Create cashflow_transactions table
    await db.query(`
      CREATE TABLE IF NOT EXISTS cashflow_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category_id INT NOT NULL,
        transaction_date DATE NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        flow_type ENUM('inflow', 'outflow') NOT NULL,
        currency VARCHAR(3) DEFAULT 'LKR',
        description TEXT,
        reference_number VARCHAR(100),
        counterparty VARCHAR(255),
        status ENUM('pending', 'confirmed', 'reconciled') DEFAULT 'pending',
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_category_id (category_id),
        INDEX idx_transaction_date (transaction_date),
        INDEX idx_flow_type (flow_type),
        INDEX idx_status (status)
      )
    `);

    // Create cashflow_projections table
    await db.query(`
      CREATE TABLE IF NOT EXISTS cashflow_projections (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category_id INT NOT NULL,
        projection_date DATE NOT NULL,
        projected_inflow DECIMAL(15,2) DEFAULT 0,
        projected_outflow DECIMAL(15,2) DEFAULT 0,
        confidence_level ENUM('low', 'medium', 'high') DEFAULT 'medium',
        notes TEXT,
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_category_id (category_id),
        INDEX idx_projection_date (projection_date),
        INDEX idx_confidence_level (confidence_level)
      )
    `);

    // Create cashflow_reconciliation table
    await db.query(`
      CREATE TABLE IF NOT EXISTS cashflow_reconciliation (
        id INT AUTO_INCREMENT PRIMARY KEY,
        reconciliation_date DATE NOT NULL,
        opening_balance DECIMAL(15,2) NOT NULL,
        closing_balance DECIMAL(15,2) NOT NULL,
        total_inflow DECIMAL(15,2) DEFAULT 0,
        total_outflow DECIMAL(15,2) DEFAULT 0,
        variance DECIMAL(15,2) DEFAULT 0,
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        notes TEXT,
        reconciled_by INT,
        reconciled_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_reconciliation_date (reconciliation_date),
        INDEX idx_status (status)
      )
    `);

    // Insert default cashflow categories
    console.log('Inserting default cashflow categories...');
    
    const defaultCategories = [
      // Operating Activities
      { name: 'Interest Income', type: 'operating', description: 'Interest earned on investments' },
      { name: 'Trading Income', type: 'operating', description: 'Income from trading activities' },
      { name: 'Fee Income', type: 'operating', description: 'Fees and commissions earned' },
      { name: 'Operating Expenses', type: 'operating', description: 'General operating expenses' },
      { name: 'Staff Costs', type: 'operating', description: 'Salaries and employee benefits' },
      { name: 'Administrative Expenses', type: 'operating', description: 'Administrative and overhead costs' },
      
      // Investing Activities
      { name: 'Investment Purchases', type: 'investing', description: 'Purchase of securities and investments' },
      { name: 'Investment Sales', type: 'investing', description: 'Sale proceeds from investments' },
      { name: 'Capital Expenditure', type: 'investing', description: 'Purchase of fixed assets' },
      { name: 'Asset Disposals', type: 'investing', description: 'Proceeds from asset sales' },
      
      // Financing Activities
      { name: 'Borrowings', type: 'financing', description: 'New borrowings and loans' },
      { name: 'Loan Repayments', type: 'financing', description: 'Repayment of principal on loans' },
      { name: 'Interest Payments', type: 'financing', description: 'Interest payments on borrowings' },
      { name: 'Dividend Payments', type: 'financing', description: 'Dividend payments to shareholders' },
      { name: 'Capital Contributions', type: 'financing', description: 'Capital injections from shareholders' }
    ];

    for (const category of defaultCategories) {
      await db.query(`
        INSERT IGNORE INTO cashflow_categories (name, type, description)
        VALUES (?, ?, ?)
      `, [category.name, category.type, category.description]);
    }

    console.log('Cashflow tables created successfully!');
    console.log('Default categories inserted successfully!');
    
    // Show created tables
    const [tables] = await db.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME LIKE 'cashflow_%'
    `);
    
    console.log('Created tables:');
    tables.forEach(table => {
      console.log(`- ${table.TABLE_NAME}`);
    });

  } catch (error) {
    console.error('Error creating cashflow tables:', error);
    throw error;
  }
}

// Run the migration
if (require.main === module) {
  createCashflowTables()
    .then(() => {
      console.log('Cashflow migration completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Cashflow migration failed:', error);
      process.exit(1);
    });
}

module.exports = createCashflowTables;