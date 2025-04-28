const fs = require('fs');
const path = require('path');
const db = require('../config/db');

async function runMigration() {
  try {
    console.log('Running authorization status migration...');
    
    // Read SQL file
    const sqlFile = path.join(__dirname, 'add_authorization_status.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');
    
    // Split into separate statements
    const statements = sql.split(';').filter(stmt => stmt.trim().length > 0);
    
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // Execute each statement
      for (const statement of statements) {
        console.log(`Executing: ${statement}`);
        await connection.query(statement);
      }
      
      await connection.commit();
      console.log('Migration completed successfully');
    } catch (error) {
      await connection.rollback();
      console.error('Migration failed:', error);
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error in migration:', error);
    process.exit(1);
  } finally {
    // Close the connection pool
    await db.end();
    console.log('Database connections closed');
  }
}

// Run the migration
runMigration();
