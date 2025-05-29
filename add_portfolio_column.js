const pool = require('./config/db');

// Add portfolio column to gsec_transactions table
pool.query('ALTER TABLE gsec_transactions ADD COLUMN portfolio VARCHAR(50) AFTER yield_rate', 
  (err, result) => {
    if (err) {
      console.error('Error adding portfolio column:', err);
    } else {
      console.log('Portfolio column added successfully:', result);
    }
    process.exit();
  }
);
