const db = require('../config/database');

async function updateTransactionsTable() {
  try {
    console.log('Updating transactions table...');
    
    // Check if status column exists
    const [columns] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'transactions' 
      AND COLUMN_NAME = 'status'
    `);
    
    // If status column doesn't exist, add it
    if (columns.length === 0) {
      console.log('Adding status column to transactions table');
      await db.query(`
        ALTER TABLE transactions 
        ADD COLUMN status VARCHAR(20) DEFAULT 'pending'
      `);
      console.log('Status column added successfully');
    } else {
      console.log('Status column already exists');
    }
    
    // Check if authorization_status column exists
    const [authColumns] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'transactions' 
      AND COLUMN_NAME = 'authorization_status'
    `);
    
    // If both columns exist, migrate data from authorization_status to status
    if (authColumns.length > 0 && columns.length > 0) {
      console.log('Migrating data from authorization_status to status');
      await db.query(`
        UPDATE transactions 
        SET status = authorization_status 
        WHERE status = 'pending' AND authorization_status IS NOT NULL
      `);
      console.log('Data migration completed');
    }
    
    // Check if comment column exists
    const [commentColumns] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'transactions' 
      AND COLUMN_NAME = 'comment'
    `);
    
    // If comment column doesn't exist, add it
    if (commentColumns.length === 0) {
      console.log('Adding comment column to transactions table');
      await db.query(`
        ALTER TABLE transactions 
        ADD COLUMN comment TEXT
      `);
      console.log('Comment column added successfully');
    } else {
      console.log('Comment column already exists');
    }
    
    console.log('Transactions table update completed successfully');
  } catch (error) {
    console.error('Error updating transactions table:', error);
  } finally {
    process.exit();
  }
}

updateTransactionsTable();
