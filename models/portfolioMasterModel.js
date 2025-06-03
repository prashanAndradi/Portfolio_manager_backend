const db = require('../config/db');

class PortfolioMaster {
  static async getAll() {
    const [rows] = await db.query('SELECT * FROM portfolio_master');
    return rows;
  }

  static async getById(id) {
    const [rows] = await db.query('SELECT * FROM portfolio_master WHERE portfolio_id = ?', [id]);
    return rows[0];
  }

  static async create(data) {
    // Convert empty string to null for parent_portfolio_id
    if (data.parent_portfolio_id === '' || data.parent_portfolio_id === undefined) {
      data.parent_portfolio_id = null;
    }
    const [result] = await db.query('INSERT INTO portfolio_master SET ?', [data]);
    return { ...data, portfolio_id: data.portfolio_id };
  }

  static async update(id, data) {
    await db.query('UPDATE portfolio_master SET ? WHERE portfolio_id = ?', [data, id]);
    return { ...data, portfolio_id: id };
  }

  static async delete(id) {
    await db.query('DELETE FROM portfolio_master WHERE portfolio_id = ?', [id]);
    return true;
  }
}

module.exports = PortfolioMaster;
