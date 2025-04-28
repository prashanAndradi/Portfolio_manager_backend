const db = require('./config/db');

async function fixTransactionsTable() {
  const connection = await db.getConnection();
  
  try {
    // Check if column exists
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'transactions' 
      AND COLUMN_NAME = 'authorization_status'
    `);
    
    if (columns.length === 0) {
      console.log('Adding authorization_status column to transactions table');
      
      // Add the column
      await connection.query(`
        ALTER TABLE transactions 
        ADD COLUMN authorization_status ENUM('pending', 'authorized', 'rejected') 
        DEFAULT 'pending'
      `);
      
      console.log('Column added successfully');
    } else {
      console.log('authorization_status column already exists');
    }
    
    // Set all null values to 'pending'
    await connection.query(`
      UPDATE transactions 
      SET authorization_status = 'pending' 
      WHERE authorization_status IS NULL
    `);
    
    console.log('Updated null values to "pending"');
    
    // Show the current columns
    const [tableDesc] = await connection.query('DESCRIBE transactions');
    console.log('Current transactions table structure:');
    console.log(tableDesc);
  } catch (error) {
    console.error('Error fixing transactions table:', error);
  } finally {
    connection.release();
    await db.end();
  }
}

fixTransactionsTable().catch(err => {
  console.error('Uncaught error:', err);
  process.exit(1);
});
