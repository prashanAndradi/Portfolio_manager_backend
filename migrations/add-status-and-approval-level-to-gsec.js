const db = require('../config/db');

// NOTE: this used to hardcode TABLE_SCHEMA = 'itms' / `itms.gsec`, which only
// ever worked when the configured database happened to be named literally
// "itms" - it would silently no-op (existence check always empty) or fail
// outright ("Unknown database 'itms'") against any other database name, e.g.
// "ITMS-LV1" or a UAT database. Uses DATABASE() / the connection's own
// database now, like every other migration in this repo.
async function addStatusAndApprovalLevelToGsec() {
  try {
    console.log('Running migration to add status and current_approval_level columns to gsec table...');

    // Check if status column exists
    const [statusColumns] = await db.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gsec'
      AND COLUMN_NAME = 'status'
    `);

    if (statusColumns.length === 0) {
      await db.query(`
        ALTER TABLE gsec
        ADD COLUMN status VARCHAR(50) DEFAULT 'pending' AFTER buy_deal_number
      `);
      console.log('✓ Added status column to gsec');
    } else {
      console.log('⏭ status column already exists in gsec');
    }

    // Check if current_approval_level column exists
    const [approvalColumns] = await db.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gsec'
      AND COLUMN_NAME = 'current_approval_level'
    `);

    if (approvalColumns.length === 0) {
      await db.query(`
        ALTER TABLE gsec
        ADD COLUMN current_approval_level VARCHAR(50) DEFAULT 'back_office_final' AFTER status
      `);
      console.log('✓ Added current_approval_level column to gsec');
    } else {
      console.log('⏭ current_approval_level column already exists in gsec');
    }

    console.log('✅ Migration completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

if (require.main === module) {
  addStatusAndApprovalLevelToGsec()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = addStatusAndApprovalLevelToGsec;
