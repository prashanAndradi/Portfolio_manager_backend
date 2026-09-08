const db = require('../config/db');

async function createTransactionDocumentsTable() {
  try {
    console.log('Running migration to create transaction_documents table...');

    // Check if table exists
    const [tables] = await db.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'transaction_documents'
    `);

    if (tables.length === 0) {
      // Create table if it doesn't exist
      console.log('Creating transaction_documents table...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS transaction_documents (
          id INT NOT NULL AUTO_INCREMENT,
          transaction_type VARCHAR(50) NOT NULL,
          transaction_id VARCHAR(255) NOT NULL,
          file_name VARCHAR(500) NOT NULL,
          file_path VARCHAR(1000) NOT NULL,
          file_size INT NOT NULL,
          mime_type VARCHAR(100) NOT NULL,
          uploaded_by INT NULL,
          description TEXT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_transaction (transaction_type, transaction_id),
          KEY idx_uploaded_by (uploaded_by),
          KEY idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✓ Created transaction_documents table');
    } else {
      console.log('⏭ transaction_documents table already exists, skipping creation');
    }

    console.log('✓ Migration completed successfully');
  } catch (error) {
    console.error('✗ Migration failed:', error);
    throw error;
  }
}

// Run migration if called directly
if (require.main === module) {
  createTransactionDocumentsTable()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = createTransactionDocumentsTable;
