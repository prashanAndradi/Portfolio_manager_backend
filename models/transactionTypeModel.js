const pool = require('../config/db');

// Get all transaction types
async function getAll() {
  const [rows] = await pool.query('SELECT * FROM transaction_types');
  return rows;
}

// Get transaction type by id
async function getById(id) {
  const [rows] = await pool.query('SELECT * FROM transaction_types WHERE id = ?', [id]);
  return rows[0] || null;
}

// Create a new transaction type
async function create(type) {
  const [result] = await pool.query('INSERT INTO transaction_types (name, description) VALUES (?, ?)', [type.name, type.description]);
  return { id: result.insertId, ...type };
}

// Update a transaction type
async function update(id, type) {
  await pool.query('UPDATE transaction_types SET name = ?, description = ? WHERE id = ?', [type.name, type.description, id]);
  return { id, ...type };
}

// Delete a transaction type
async function deleteType(id) {
  await pool.query('DELETE FROM transaction_types WHERE id = ?', [id]);
}

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: deleteType
};

