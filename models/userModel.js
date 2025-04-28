const db = require('../config/database');

class User {
  static async create({ username, password, role }) {
    try {
      const [result] = await db.query(
        'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
        [username, password, role]
      );
      return { id: result.insertId, username, role };
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }
  
  static async findByUsername(username) {
    try {
      const [rows] = await db.query(
        'SELECT * FROM users WHERE username = ?',
        [username]
      );
      return rows[0];
    } catch (error) {
      console.error('Error finding user by username:', error);
      throw error;
    }
  }
  
  static async getAll() {
    try {
      const [rows] = await db.query('SELECT id, username, role, created_at FROM users');
      return rows;
    } catch (error) {
      console.error('Error getting all users:', error);
      throw error;
    }
  }
}

module.exports = User;
