const db = require('../db');

const Counterparty = {
  getAll: (callback) => {
    db.query('SELECT * FROM counterparties', callback);
  },
  getById: (id, callback) => {
    db.query('SELECT * FROM counterparties WHERE id = ?', [id], callback);
  },
  create: (counterparty, callback) => {
    db.query('INSERT INTO counterparties (name, type, contact_info) VALUES (?, ?, ?)', [counterparty.name, counterparty.type, counterparty.contact_info], callback);
  },
  update: (id, counterparty, callback) => {
    db.query('UPDATE counterparties SET name = ?, type = ?, contact_info = ? WHERE id = ?', [counterparty.name, counterparty.type, counterparty.contact_info, id], callback);
  },
  delete: (id, callback) => {
    db.query('DELETE FROM counterparties WHERE id = ?', [id], callback);
  }
};

module.exports = Counterparty;
