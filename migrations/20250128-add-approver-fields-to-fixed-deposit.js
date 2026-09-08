const db = require('../config/db');

async function addApproverFieldsToFixedDeposit() {
  try {
    // Check if approver_id column exists in itms database
    const [columns] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fixed_deposit_requests' 
      AND COLUMN_NAME = 'approver_id'
    `);
    
    if (columns.length === 0) {
      // Add approver fields
      await db.query(`
        ALTER TABLE fixed_deposit_requests 
        ADD COLUMN approver_id INT NULL AFTER maturity_date,
        ADD COLUMN approver_name VARCHAR(255) NULL AFTER approver_id,
        ADD COLUMN approver_designation VARCHAR(255) NULL AFTER approver_name,
        ADD COLUMN approval_category VARCHAR(100) NULL AFTER approver_designation,
        ADD COLUMN approval_limit_required VARCHAR(255) NULL AFTER approval_category,
        ADD COLUMN approver_notes TEXT NULL AFTER approval_limit_required
      `);
      console.log('✓ Added approver fields to fixed_deposit_requests');
    } else {
      console.log('⏭ Approver fields already exist in fixed_deposit_requests');
    }
    
    // Check and add index for approver_id
    const [indexes] = await db.query(`
      SELECT INDEX_NAME 
      FROM INFORMATION_SCHEMA.STATISTICS 
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fixed_deposit_requests' 
      AND INDEX_NAME = 'idx_approver_id'
    `);
    
    if (indexes.length === 0) {
      await db.query(`
        CREATE INDEX idx_approver_id ON fixed_deposit_requests(approver_id)
      `);
      console.log('✓ Added index on approver_id for fixed_deposit_requests');
    } else {
      console.log('⏭ Index idx_approver_id already exists');
    }
    
    // Optionally remove approval_history column if it exists
    const [historyColumns] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fixed_deposit_requests' 
      AND COLUMN_NAME = 'approval_history'
    `);
    
    if (historyColumns.length > 0) {
      await db.query(`
        ALTER TABLE fixed_deposit_requests DROP COLUMN approval_history
      `);
      console.log('✓ Removed approval_history column from fixed_deposit_requests');
    } else {
      console.log('⏭ approval_history column does not exist (already removed or never existed)');
    }
    
    console.log('✅ Migration completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run the migration
if (require.main === module) {
  addApproverFieldsToFixedDeposit()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = addApproverFieldsToFixedDeposit;
