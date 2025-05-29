// Script to check if the gsec table exists and create it if needed
const db = require('../config/database');

async function checkAndFixGsecTable() {
  try {
    console.log('Checking gsec table...');
    
    // Check if the gsec table exists
    const [tables] = await db.query(`SHOW TABLES LIKE 'gsec'`);
    
    if (tables.length === 0) {
      console.log('GSec table does not exist. Creating it...');
      
      // Create the gsec table with all required columns
      const createTableSQL = `
        CREATE TABLE gsec (
          id INT AUTO_INCREMENT PRIMARY KEY,
          trade_type VARCHAR(50),
          transaction_type VARCHAR(50),
          counterparty INT,
          deal_number VARCHAR(50),
          isin VARCHAR(50),
          face_value DECIMAL(20,4),
          value_date DATE,
          next_coupon_date DATE,
          last_coupon_date DATE,
          number_of_days_interest_accrued INT,
          number_of_days_for_coupon_period INT,
          accrued_interest DECIMAL(20,6),
          coupon_interest DECIMAL(20,6),
          clean_price DECIMAL(20,6),
          dirty_price DECIMAL(20,6),
          accrued_interest_calculation TEXT,
          accrued_interest_six_decimals DECIMAL(20,6),
          accrued_interest_for_100 DECIMAL(20,6),
          settlement_amount DECIMAL(20,4),
          settlement_mode VARCHAR(50),
          issue_date DATE,
          maturity_date DATE,
          coupon_dates TEXT,
          yield DECIMAL(10,4),
          brokerage DECIMAL(10,4),
          currency VARCHAR(10),
          portfolio VARCHAR(50),
          strategy VARCHAR(50),
          broker VARCHAR(50),
          accrued_interest_adjustment DECIMAL(20,6),
          clean_price_adjustment DECIMAL(20,6),
          status VARCHAR(20) DEFAULT 'pending',
          comment TEXT,
          created_by INT,
          created_at DATETIME,
          updated_by INT,
          updated_at DATETIME,
          authorized_by INT,
          authorized_at DATETIME
        )
      `;
      
      await db.query(createTableSQL);
      console.log('GSec table created successfully.');
      
      // Insert a sample record for testing
      const sampleRecord = `
        INSERT INTO gsec (
          trade_type, transaction_type, counterparty, isin, face_value, 
          value_date, accrued_interest, clean_price, dirty_price, 
          currency, portfolio, strategy, status, created_at
        ) VALUES (
          'Primary', 'Buy', 1, 'LK1234567890', 1000000, 
          '2025-05-29', 1256.34, 102.5, 103.7563, 
          'LKR', 'Fixed Income', 'Hold to Maturity', 'pending', NOW()
        )
      `;
      
      await db.query(sampleRecord);
      console.log('Sample GSec record inserted.');
    } else {
      console.log('GSec table already exists, checking columns...');
      
      // Check if the authorization columns exist
      const [columns] = await db.query('DESCRIBE gsec');
      const columnNames = columns.map(col => col.Field);
      
      // Check for required authorization columns
      const requiredColumns = ['status', 'comment', 'created_by', 'created_at', 'authorized_by', 'authorized_at'];
      const missingColumns = requiredColumns.filter(col => !columnNames.includes(col));
      
      if (missingColumns.length > 0) {
        console.log(`Missing columns: ${missingColumns.join(', ')}. Adding them...`);
        
        // Add missing columns
        for (const column of missingColumns) {
          let alterSQL = '';
          
          switch (column) {
            case 'status':
              alterSQL = `ALTER TABLE gsec ADD COLUMN status VARCHAR(20) DEFAULT 'pending'`;
              break;
            case 'comment':
              alterSQL = `ALTER TABLE gsec ADD COLUMN comment TEXT`;
              break;
            case 'created_by':
              alterSQL = `ALTER TABLE gsec ADD COLUMN created_by INT`;
              break;
            case 'created_at':
              alterSQL = `ALTER TABLE gsec ADD COLUMN created_at DATETIME`;
              break;
            case 'authorized_by':
              alterSQL = `ALTER TABLE gsec ADD COLUMN authorized_by INT`;
              break;
            case 'authorized_at':
              alterSQL = `ALTER TABLE gsec ADD COLUMN authorized_at DATETIME`;
              break;
          }
          
          if (alterSQL) {
            try {
              await db.query(alterSQL);
              console.log(`Added column: ${column}`);
            } catch (err) {
              console.error(`Error adding column ${column}:`, err.message);
            }
          }
        }
      } else {
        console.log('All required columns exist in gsec table.');
      }
    }
    
    console.log('GSec table check completed successfully.');
    
  } catch (error) {
    console.error('Error checking/fixing gsec table:', error);
  } finally {
    // Close the database connection
    process.exit(0);
  }
}

// Run the function
checkAndFixGsecTable();
