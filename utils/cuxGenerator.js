const db = require('../config/db');

/**
 * Generate a unique CUX number for counterparties
 * Format: CUX followed by a 6-digit number (e.g., CUX000001, CUX000002)
 * 
 * @param {string} type - Counterparty type: 'individual', 'joint', or 'corporate'
 * @returns {Promise<string>} - Generated CUX number
 */
async function generateCuxNumber(type = 'individual') {
  try {
    // Get the highest CUX number from all counterparty tables
    const queries = [
      `SELECT MAX(CAST(SUBSTRING(cux_number, 4) AS UNSIGNED)) as max_num 
       FROM counterparty_master_individual 
       WHERE cux_number IS NOT NULL AND cux_number REGEXP '^CUX[0-9]+$'`,
      `SELECT MAX(CAST(SUBSTRING(cux_number, 4) AS UNSIGNED)) as max_num 
       FROM counterparty_master_joint 
       WHERE cux_number IS NOT NULL AND cux_number REGEXP '^CUX[0-9]+$'`,
      `SELECT MAX(CAST(SUBSTRING(cux_number, 4) AS UNSIGNED)) as max_num 
       FROM counterparty_master_corporate 
       WHERE cux_number IS NOT NULL AND cux_number REGEXP '^CUX[0-9]+$'`
    ];

    const results = await Promise.all(queries.map((query) => {
      return db.query(query).catch(err => {
        // If table doesn't exist or column doesn't exist, return empty result
        console.warn('Query failed (table/column may not exist yet):', err.message);
        return [[{ max_num: null }]];
      });
    }));
    
    // Find the maximum number across all tables
    let maxNumber = 0;
    results.forEach(result => {
      const [rows] = result;
      if (rows && rows.length > 0 && rows[0] && rows[0].max_num !== null && rows[0].max_num !== undefined) {
        const num = parseInt(rows[0].max_num) || 0;
        if (num > maxNumber) {
          maxNumber = num;
        }
      }
    });

    // Generate next CUX number (increment by 1)
    // Start from 1 if no existing CUX numbers found
    const nextNumber = maxNumber + 1;
    
    // Format as CUX followed by 6-digit number (e.g., CUX000001)
    const cuxNumber = `CUX${String(nextNumber).padStart(6, '0')}`;
    return cuxNumber;
  } catch (error) {
    console.error('Error generating CUX number:', error);
    // Fallback: use timestamp-based number if query fails
    const timestamp = Date.now() % 1000000; // Last 6 digits of timestamp
    const fallbackCux = `CUX${String(timestamp).padStart(6, '0')}`;
    return fallbackCux;
  }
}

module.exports = {
  generateCuxNumber
};
