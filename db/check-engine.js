const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

async function checkDatabaseEngine() {
  let connection;

  try {
    // Create a connection
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306
    });
    
    // Check table engines
    const [tableInfo] = await connection.query(`
      SELECT table_name, engine
      FROM information_schema.tables
      WHERE table_schema = ? 
      AND table_name IN ('accounts', 'transaction_types', 'transactions')
    `, [process.env.DB_NAME]);
    
    console.log('Table engine information:');
    tableInfo.forEach(table => {
      console.log(`- ${table.TABLE_NAME || table.table_name}: ${table.ENGINE || table.engine}`);
      if ((table.ENGINE || table.engine) !== 'InnoDB') {
        console.warn(`WARNING: Table ${table.TABLE_NAME || table.table_name} is not using InnoDB engine!`);
      }
    });
    
    // Check if all needed tables are there
    if (tableInfo.length < 3) {
      console.error(`Missing tables! Only found ${tableInfo.length} of the 3 required tables.`);
    }
    
    // Try a direct insert and verify it
    console.log('\nTesting direct database write...');
    
    try {
      await connection.beginTransaction();
      
      // Insert test transaction
      const testDesc = `Test transaction ${new Date().toISOString()}`;
      const [insertResult] = await connection.query(
        'INSERT INTO transactions (source_account_id, transaction_type_id, amount, date, description) VALUES (?, ?, ?, ?, ?)',
        [1, 1, 50.00, new Date().toISOString().split('T')[0], testDesc]
      );
      
      console.log(`Test transaction inserted with ID: ${insertResult.insertId}`);
      
      // Verify the transaction was inserted
      const [verifyResult] = await connection.query(
        'SELECT * FROM transactions WHERE id = ?',
        [insertResult.insertId]
      );
      
      if (verifyResult.length > 0) {
        console.log('Verification successful - transaction was stored in the database');
        console.log('Transaction data:', verifyResult[0]);
      } else {
        console.error('Verification FAILED - transaction was not found in the database');
      }
      
      // Rollback to clean up test data
      await connection.rollback();
      console.log('Test transaction rolled back (cleanup)');
    } catch (err) {
      console.error('Error during test transaction:', err.message);
      await connection.rollback();
    }
    
  } catch (error) {
    console.error('Error checking database engine:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run the check
checkDatabaseEngine(); 