const db = require('../config/db');

class Account {
  // Get all accounts
  static async getAll() {
    try {
      const [rows] = await db.query('SELECT * FROM accounts ORDER BY name');
      return rows;
    } catch (error) {
      throw error;
    }
  }

  // Get a single account by ID
  static async getById(id) {
    try {
      const [rows] = await db.query('SELECT * FROM accounts WHERE id = ?', [id]);
      return rows[0];
    } catch (error) {
      throw error;
    }
  }

  // Create a new account
  static async create(account) {
    try {
      const [result] = await db.query(
        'INSERT INTO accounts (name, balance) VALUES (?, ?)', 
        [account.name, account.balance]
      );
      return { id: result.insertId, ...account };
    } catch (error) {
      throw error;
    }
  }

  // Update an account
  static async update(id, account) {
    try {
      await db.query(
        'UPDATE accounts SET name = ?, balance = ? WHERE id = ?',
        [account.name, account.balance, id]
      );
      return { id, ...account };
    } catch (error) {
      throw error;
    }
  }

  // Update account balance
  static async updateBalance(id, amount) {
    try {
      await db.query(
        'UPDATE accounts SET balance = balance + ? WHERE id = ?',
        [amount, id]
      );
      
      // Get updated account
      const [rows] = await db.query('SELECT * FROM accounts WHERE id = ?', [id]);
      return rows[0];
    } catch (error) {
      throw error;
    }
  }

  // Delete an account
  static async delete(id) {
    try {
      await db.query('DELETE FROM accounts WHERE id = ?', [id]);
      return id;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = Account; 