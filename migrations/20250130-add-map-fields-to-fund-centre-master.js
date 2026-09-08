const db = require('../config/db');

// Was hardcoded to TABLE_SCHEMA = 'itms' / `itms.??` - only worked when the
// configured database happened to be named literally "itms". Uses
// DATABASE() / the connection's own database now.
async function addMapFieldsToFundCentreMaster() {
  try {
    console.log('Running migration to add map fields to fund_centre_master table...');

    const tableName = 'fund_centre_master';

    // Add city column
    const [cityColumns] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ? 
      AND COLUMN_NAME = 'city'
    `, [tableName]);

    if (cityColumns.length === 0) {
      await db.query(`ALTER TABLE ?? ADD COLUMN city VARCHAR(100) NULL AFTER name`, [tableName]);
      console.log('✓ Added city column to fund_centre_master');
    } else {
      console.log('⏭ city column already exists');
    }

    // Add iana_timezone column
    const [ianaColumns] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ? 
      AND COLUMN_NAME = 'iana_timezone'
    `, [tableName]);

    if (ianaColumns.length === 0) {
      await db.query(`ALTER TABLE ?? ADD COLUMN iana_timezone VARCHAR(100) NULL AFTER gmt_timezone`, [tableName]);
      console.log('✓ Added iana_timezone column to fund_centre_master');
    } else {
      console.log('⏭ iana_timezone column already exists');
    }

    // Add latitude column
    const [latColumns] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ? 
      AND COLUMN_NAME = 'latitude'
    `, [tableName]);

    if (latColumns.length === 0) {
      await db.query(`ALTER TABLE ?? ADD COLUMN latitude DECIMAL(10, 8) NULL AFTER country`, [tableName]);
      console.log('✓ Added latitude column to fund_centre_master');
    } else {
      console.log('⏭ latitude column already exists');
    }

    // Add longitude column
    const [lngColumns] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ? 
      AND COLUMN_NAME = 'longitude'
    `, [tableName]);

    if (lngColumns.length === 0) {
      await db.query(`ALTER TABLE ?? ADD COLUMN longitude DECIMAL(11, 8) NULL AFTER latitude`, [tableName]);
      console.log('✓ Added longitude column to fund_centre_master');
    } else {
      console.log('⏭ longitude column already exists');
    }

    // Add dst_observed column
    const [dstColumns] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ? 
      AND COLUMN_NAME = 'dst_observed'
    `, [tableName]);

    if (dstColumns.length === 0) {
      await db.query(`ALTER TABLE ?? ADD COLUMN dst_observed ENUM('Y', 'N') DEFAULT 'N' AFTER iana_timezone`, [tableName]);
      console.log('✓ Added dst_observed column to fund_centre_master');
    } else {
      console.log('⏭ dst_observed column already exists');
    }

    console.log('✅ Add map fields to fund_centre_master migration completed successfully');
  } catch (error) {
    console.error('❌ Add map fields to fund_centre_master migration failed:', error);
    throw error;
  }
}

if (require.main === module) {
  addMapFieldsToFundCentreMaster()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = addMapFieldsToFundCentreMaster;
