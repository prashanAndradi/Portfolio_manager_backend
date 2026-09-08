const db = require('../config/db');

async function addFileNumberToFixedDeposit() {
  try {
    console.log('Running migration to add file_number column to fixed_deposit_requests table...');

    const tableName = 'fixed_deposit_requests';
    const columnName = 'file_number';

    // Check if column already exists in itms database
    const [columns] = await db.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    `, [tableName, columnName]);

    if (columns.length === 0) {
      await db.query(`
        ALTER TABLE ??
        ADD COLUMN ?? VARCHAR(100) NULL AFTER request_no
      `, [tableName, columnName]);
      console.log(`✓ Added ${columnName} column to itms.${tableName}`);
    } else {
      console.log(`⏭ ${columnName} column already exists in itms.${tableName}`);
    }

    console.log('✅ File number migration completed successfully');
  } catch (error) {
    console.error('❌ File number migration failed:', error);
    throw error;
  }
}

if (require.main === module) {
  addFileNumberToFixedDeposit()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = addFileNumberToFixedDeposit;
