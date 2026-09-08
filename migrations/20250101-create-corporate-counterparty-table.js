const db = require('../config/db');

async function createCorporateCounterpartyTable() {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS counterparty_master_corporate (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_name VARCHAR(200) NOT NULL,
        short_name VARCHAR(100),
        long_name VARCHAR(200),
        registration_number VARCHAR(100),
        tin_number VARCHAR(100),
        vat_number VARCHAR(100),
        address_line1 VARCHAR(200),
        address_line2 VARCHAR(200),
        city VARCHAR(100),
        state VARCHAR(100),
        country VARCHAR(100),
        postal_code VARCHAR(20),
        phone_number VARCHAR(50),
        email VARCHAR(100),
        website VARCHAR(200),
        kyc_status ENUM('Pending', 'Verified', 'Rejected') DEFAULT 'Pending',
        risk_category ENUM('Low', 'Medium', 'High') DEFAULT 'Low',
        sanctions_check ENUM('Passed', 'Failed') DEFAULT 'Passed',
        credit_limit DECIMAL(18,2) DEFAULT 0.00,
        primary_bank_name VARCHAR(200),
        bank_account_number VARCHAR(100),
        swift_bic_code VARCHAR(20),
        treasury_contact_person VARCHAR(200),
        treasury_contact_email VARCHAR(100),
        treasury_contact_phone VARCHAR(50),
        custodian_bank VARCHAR(200),
        cds_account VARCHAR(100),
        cux_number VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_corporate_cux (cux_number),
        INDEX idx_corporate_short_name (short_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    
    await db.query(sql);
    console.log('Corporate counterparty table created successfully');
  } catch (error) {
    console.error('Error creating corporate counterparty table:', error);
    throw error;
  }
}

// Run the migration
if (require.main === module) {
  createCorporateCounterpartyTable()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = createCorporateCounterpartyTable;
