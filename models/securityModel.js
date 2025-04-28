const db = require('../db');

const Security = {
  getAll: (callback) => {
    db.query('SELECT * FROM securities', callback);
  },
  getById: (id, callback) => {
    db.query('SELECT * FROM securities WHERE id = ?', [id], callback);
  },
  create: (security, callback) => {
    db.query('INSERT INTO securities (name, type, description) VALUES (?, ?, ?)', [security.name, security.type, security.description], callback);
  },
  update: (id, security, callback) => {
    db.query('UPDATE securities SET name = ?, type = ?, description = ? WHERE id = ?', [security.name, security.type, security.description, id], callback);
  },
  delete: (id, callback) => {
    db.query('DELETE FROM securities WHERE id = ?', [id], callback);
  }
};

module.exports = Security;
