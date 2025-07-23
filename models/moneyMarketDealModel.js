const pool = require('../db');

// Get all deals
async function getAllDeals() {
  const [rows] = await pool.query('SELECT * FROM `money_market_deals`');
  return rows;
}

module.exports = { getAllDeals };
