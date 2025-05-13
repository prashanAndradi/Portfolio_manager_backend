const db = require('../config/database');

class User {
  static async create({ username, password, role, allowed_tabs }) {
    try {
      const [result] = await db.query(
        'INSERT INTO users (username, password, role, allowed_tabs) VALUES (?, ?, ?, ?)',
        [username, password, role, allowed_tabs ? JSON.stringify(allowed_tabs) : null]
      );
      return { id: result.insertId, username, role, allowed_tabs };
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }
  
  static async updateAllowedTabs(id, allowed_tabs) {
    try {
      await db.query(
        'UPDATE users SET allowed_tabs = ? WHERE id = ?',
        [JSON.stringify(allowed_tabs), id]
      );
      return true;
    } catch (error) {
      console.error('Error updating allowed_tabs:', error);
      throw error;
    }
  }

  static async findByUsername(username) {
    try {
      const [rows] = await db.query(
        'SELECT * FROM users WHERE username = ?',
        [username]
      );
      const user = rows[0];
      if (user && user.allowed_tabs) {
        user.allowed_tabs = JSON.parse(user.allowed_tabs);
      }
      return user;
    } catch (error) {
      console.error('Error finding user by username:', error);
      throw error;
    }
  }
  
  static async getAll() {
    try {
      const [rows] = await db.query('SELECT id, username, role, created_at, allowed_tabs FROM users');
      return rows.map(row => ({
        ...row,
        allowed_tabs: row.allowed_tabs ? JSON.parse(row.allowed_tabs) : []
      }));
    } catch (error) {
      console.error('Error getting all users:', error);
      throw error;
    }
  }
}

module.exports = User;
