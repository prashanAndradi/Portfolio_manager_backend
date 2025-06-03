const db = require('../db');

async function createStrategyMasterTable() {
  try {
    console.log('Checking if strategy_master table exists...');
    
    // Check if the table exists
    const [tables] = await db.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'strategy_master'
    `);
    
    if (tables.length === 0) {
      console.log('Creating strategy_master table...');
      
      // Create the table if it doesn't exist
      await db.query(`
        CREATE TABLE strategy_master (
          strategy_id VARCHAR(50) PRIMARY KEY,
          portfolio_name VARCHAR(100) NOT NULL,
          strategy_type VARCHAR(50) NOT NULL,
          entity_business_unit VARCHAR(100) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      
      console.log('strategy_master table created successfully.');
      
      // Insert some sample data
      await db.query(`
        INSERT INTO strategy_master (strategy_id, portfolio_name, strategy_type, entity_business_unit)
        VALUES 
          ('STR001', 'Main Portfolio', 'Trading', 'Finance'),
          ('STR002', 'Secondary Portfolio', 'Investment', 'Finance'),
          ('STR003', 'Reserve Portfolio', 'Liquidity', 'Marketing')
      `);
      
      console.log('Sample data inserted into strategy_master table.');
    } else {
      console.log('strategy_master table already exists.');
    }
    
    // Test the table by reading data
    const [strategies] = await db.query('SELECT * FROM strategy_master');
    console.log(`Retrieved ${strategies.length} strategies from the database.`);
    
    return 'Strategy master table check completed successfully';
  } catch (error) {
    console.error('Error creating strategy_master table:', error);
    throw error;
  }
}

// Execute the function if this script is run directly
if (require.main === module) {
  createStrategyMasterTable()
    .then(console.log)
    .catch(console.error)
    .finally(() => process.exit());
}

module.exports = createStrategyMasterTable;
