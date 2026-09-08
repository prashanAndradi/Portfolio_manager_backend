const db = require('../config/db');

async function ensureFundCentreMasterTable() {
  try {
    console.log('Running migration to ensure fund_centre_master table is up to date...');

    // Check if table exists
    const [tables] = await db.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fund_centre_master'
    `);

    if (tables.length === 0) {
      // Create table if it doesn't exist
      console.log('Creating fund_centre_master table...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS fund_centre_master (
          id INT NOT NULL AUTO_INCREMENT,
          name VARCHAR(255) NOT NULL,
          city VARCHAR(100) NULL,
          fund_centre_code VARCHAR(50) NOT NULL,
          country VARCHAR(100) NOT NULL,
          latitude DECIMAL(10, 8) NULL,
          longitude DECIMAL(11, 8) NULL,
          gmt_timezone VARCHAR(50) NOT NULL,
          iana_timezone VARCHAR(100) NULL,
          dst_observed ENUM('Y', 'N') DEFAULT 'N',
          currency VARCHAR(10) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY unique_fund_centre_code (fund_centre_code),
          KEY idx_fund_centre_code (fund_centre_code),
          KEY idx_country (country)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✓ Created fund_centre_master table');
    } else {
      console.log('⏭ fund_centre_master table already exists, checking for missing columns...');
    }

    // Check and add missing columns
    const requiredColumns = [
      { name: 'city', type: 'VARCHAR(100) NULL', after: 'name' },
      { name: 'latitude', type: 'DECIMAL(10, 8) NULL', after: 'country' },
      { name: 'longitude', type: 'DECIMAL(11, 8) NULL', after: 'latitude' },
      { name: 'iana_timezone', type: 'VARCHAR(100) NULL', after: 'gmt_timezone' },
      { name: 'dst_observed', type: "ENUM('Y', 'N') DEFAULT 'N'", after: 'iana_timezone' }
    ];

    for (const col of requiredColumns) {
      const [columns] = await db.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'fund_centre_master' 
        AND COLUMN_NAME = ?
      `, [col.name]);

      if (columns.length === 0) {
        await db.query(`
          ALTER TABLE fund_centre_master
          ADD COLUMN \`${col.name}\` ${col.type} AFTER \`${col.after}\`
        `);
        console.log(`✓ Added ${col.name} column to fund_centre_master`);
      } else {
        console.log(`⏭ ${col.name} column already exists`);
      }
    }

    console.log('✅ Fund centre master table migration completed successfully');
  } catch (error) {
    console.error('❌ Fund centre master table migration failed:', error);
    throw error;
  }
}

if (require.main === module) {
  ensureFundCentreMasterTable()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = ensureFundCentreMasterTable;
