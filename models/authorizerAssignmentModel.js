const db = require('../config/db');

class AuthorizerAssignment {
  static async getAll() {
    const [rows] = await db.query('SELECT * FROM authorizer_assignments');
    return rows;
  }

  static async createOrUpdate({ user_id, role, per_deal_limit, per_day_limit, allowed_pages }) {
    const [existing] = await db.query(
      'SELECT * FROM authorizer_assignments WHERE user_id = ? AND role = ?',
      [user_id, role]
    );
    if (existing.length > 0) {
      await db.query(
        'UPDATE authorizer_assignments SET per_deal_limit=?, per_day_limit=?, allowed_pages=? WHERE user_id=? AND role=?',
        [per_deal_limit, per_day_limit, JSON.stringify(allowed_pages), user_id, role]
      );
    } else {
      await db.query(
        'INSERT INTO authorizer_assignments (user_id, role, per_deal_limit, per_day_limit, allowed_pages) VALUES (?, ?, ?, ?, ?)',
        [user_id, role, per_deal_limit, per_day_limit, JSON.stringify(allowed_pages)]
      );
    }
    const [rows] = await db.query('SELECT * FROM authorizer_assignments WHERE user_id = ? AND role = ?', [user_id, role]);
    return rows[0];
  }
}

module.exports = AuthorizerAssignment;
