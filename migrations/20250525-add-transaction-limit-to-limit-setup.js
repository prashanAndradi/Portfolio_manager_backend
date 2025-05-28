const db = require('../config/database');

async function addTransactionLimitToLimitSetup() {
  try {
    // Add transaction_limit and currency columns if not already present
    await db.query(`
      ALTER TABLE counterparty_limits 
      ADD COLUMN product_transaction_limit DECIMAL(15, 2) DEFAULT 0.00,
      ADD COLUMN currency VARCHAR(10) DEFAULT 'LKR';
    `);
    console.log('Added product_transaction_limit and currency columns to counterparty_limits table');
  } catch (err) {
    // If columns already exist, print a message
    if (err.message.includes('Duplicate column name')) {
      console.log('Columns already exist, skipping migration.');
    } else {
      throw err;
    }
  }
}

addTransactionLimitToLimitSetup();
