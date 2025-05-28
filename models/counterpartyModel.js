const pool = require('../config/db');

// Get all counterparties from both individual and joint tables
async function getAll() {
  const sql = `
    SELECT id, short_name AS name, 'individual' AS type FROM counterparty_master_individual
    UNION ALL
    SELECT id, short_name AS name, 'joint' AS type FROM counterparty_master_joint
    ORDER BY name
  `;
  const [rows] = await pool.query(sql);
  return rows;
}

// Get a single counterparty by id from either table
async function getById(id) {
  const [individual] = await pool.query('SELECT id, short_name AS name, "individual" AS type FROM counterparty_master_individual WHERE id = ?', [id]);
  if (individual.length > 0) return individual[0];
  const [joint] = await pool.query('SELECT id, short_name AS name, "joint" AS type FROM counterparty_master_joint WHERE id = ?', [id]);
  if (joint.length > 0) return joint[0];
  return null;
}

module.exports = {
  getAll,
  getById
};
