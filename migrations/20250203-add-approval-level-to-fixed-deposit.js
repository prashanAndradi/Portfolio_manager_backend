const db = require('../config/db');

async function addApprovalLevelToFixedDeposit() {
  try {
    // Check if column exists
    const [columns] = await db.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'fixed_deposit_requests'
        AND COLUMN_NAME = 'current_approval_level'
    `);

    if (columns.length === 0) {
      // Add current_approval_level column
      await db.query(`
        ALTER TABLE fixed_deposit_requests
        ADD COLUMN current_approval_level VARCHAR(50) DEFAULT 'back_office_final' AFTER status
      `);
      console.log('Added current_approval_level column to fixed_deposit_requests table');
    } else {
      console.log('current_approval_level column already exists');
    }
  } catch (error) {
    console.error('Error adding current_approval_level column:', error);
    throw error;
  }
}

if (require.main === module) {
  addApprovalLevelToFixedDeposit()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = addApprovalLevelToFixedDeposit;
