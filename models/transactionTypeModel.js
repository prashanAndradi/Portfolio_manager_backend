const db = require('../db');

const TransactionType = {
  getAll: (callback) => {
    db.query('SELECT * FROM transaction_types', callback);
  },
  getById: (id, callback) => {
    db.query('SELECT * FROM transaction_types WHERE id = ?', [id], callback);
  },
  create: (type, callback) => {
    db.query('INSERT INTO transaction_types (name, description) VALUES (?, ?)', [type.name, type.description], callback);
  },
  update: (id, type, callback) => {
    db.query('UPDATE transaction_types SET name = ?, description = ? WHERE id = ?', [type.name, type.description, id], callback);
  },
  delete: (id, callback) => {
    db.query('DELETE FROM transaction_types WHERE id = ?', [id], callback);
  }
};

module.exports = TransactionType;
