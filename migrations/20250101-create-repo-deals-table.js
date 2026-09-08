const db = require('../config/db');

const createRepoDealsTable = async () => {
  try {
          const sql = `
        CREATE TABLE IF NOT EXISTS repo_deals (
          id INT AUTO_INCREMENT PRIMARY KEY,
          deal_type ENUM('Repo', 'Reverse Repo') NOT NULL,
          counterparty_id INT NOT NULL,
          
          trade_date DATE NOT NULL,
          value_date DATE NOT NULL,
          maturity_date DATE NOT NULL,
          principal_amount DECIMAL(20,4) NOT NULL,
          interest_amount DECIMAL(20,4) NOT NULL,
          rate DECIMAL(10,4) NOT NULL,
          maturity_amount DECIMAL(20,4) NOT NULL,
          tenor INT NOT NULL,
          calculation_day_basis INT NOT NULL DEFAULT 365,
          isin_number VARCHAR(50) NOT NULL,
          issue_date VARCHAR(20),
          haircut DECIMAL(5,2) DEFAULT 0.00,
          face_value DECIMAL(20,4),
          status ENUM('Pending', 'Active', 'Matured', 'Cancelled') DEFAULT 'Pending',
          created_by INT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_deal_type (deal_type),
                     INDEX idx_counterparty (counterparty_id),
          INDEX idx_trade_date (trade_date),
          INDEX idx_maturity_date (maturity_date),
          INDEX idx_status (status),
          INDEX idx_isin (isin_number)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `;

    await db.query(sql);
    console.log('✅ repo_deals table created successfully');

  } catch (error) {
    console.error('❌ Error creating repo_deals table:', error);
    throw error;
  }
};

// Run the migration if this file is executed directly
if (require.main === module) {
  createRepoDealsTable()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = createRepoDealsTable;
