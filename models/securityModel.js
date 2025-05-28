const pool = require('../config/db');

// Get all securities
async function getAll() {
  const [rows] = await pool.query('SELECT * FROM securities');
  return rows;
}

// Get security by id
async function getById(id) {
  const [rows] = await pool.query('SELECT * FROM securities WHERE id = ?', [id]);
  return rows[0] || null;
}

// Create a new security
async function create(security) {
  const [result] = await pool.query('INSERT INTO securities (name, type, description) VALUES (?, ?, ?)', [security.name, security.type, security.description]);
  return { id: result.insertId, ...security };
}

// Update a security
async function update(id, security) {
  await pool.query('UPDATE securities SET name = ?, type = ?, description = ? WHERE id = ?', [security.name, security.type, security.description, id]);
  return { id, ...security };
}

// Delete a security
async function deleteSecurity(id) {
  await pool.query('DELETE FROM securities WHERE id = ?', [id]);
}

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: deleteSecurity
};

