const pool = require('./config/db');

// Add both portfolio and strategy columns to gsec_transactions table
const addColumns = async () => {
  try {
    // First check if columns exist
    console.log('Checking if columns already exist...');
    const [columns] = await pool.promise().query('SHOW COLUMNS FROM gsec_transactions');
    const columnNames = columns.map(col => col.Field);
    
    // Add portfolio column if it doesn't exist
    if (!columnNames.includes('portfolio')) {
      console.log('Adding portfolio column...');
      await pool.promise().query('ALTER TABLE gsec_transactions ADD COLUMN portfolio VARCHAR(50) AFTER yield_rate');
      console.log('Portfolio column added successfully');
    } else {
      console.log('Portfolio column already exists');
    }
    
    // Add strategy column if it doesn't exist
    if (!columnNames.includes('strategy')) {
      console.log('Adding strategy column...');
      await pool.promise().query('ALTER TABLE gsec_transactions ADD COLUMN strategy VARCHAR(50) AFTER portfolio');
      console.log('Strategy column added successfully');
    } else {
      console.log('Strategy column already exists');
    }
    
    console.log('All columns added successfully');
  } catch (error) {
    console.error('Error adding columns:', error);
  } finally {
    process.exit();
  }
};

addColumns();
