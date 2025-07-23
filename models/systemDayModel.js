const pool = require('../db');

// Get latest system day
async function getSystemDay() {
  const [rows] = await pool.query('SELECT * FROM system_day ORDER BY id DESC LIMIT 1');
  return rows[0];
}

// Set new system day
async function setSystemDay(system_date) {
  const [result] = await pool.query(
    'INSERT INTO system_day (system_date, last_updated) VALUES (?, NOW())',
    [system_date]
  );
  return result.insertId;
}

module.exports = { getSystemDay, setSystemDay };
