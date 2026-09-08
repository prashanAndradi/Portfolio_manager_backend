const db = require('../config/db');

const Notification = {
  create: async ({ user_id, type, title, message, deal_number, product_type }) => {
    const [result] = await db.query(
      `INSERT INTO notifications (user_id, type, title, message, deal_number, product_type)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, type, title, message, deal_number || null, product_type || null]
    );
    return result;
  },

  // Insert one row per recipient in a single statement.
  createMany: async (rows) => {
    if (!rows || !rows.length) return { affectedRows: 0 };
    const values = rows.map((r) => [
      r.user_id, r.type, r.title, r.message, r.deal_number || null, r.product_type || null
    ]);
    const [result] = await db.query(
      `INSERT INTO notifications (user_id, type, title, message, deal_number, product_type) VALUES ?`,
      [values]
    );
    return result;
  },

  listForUser: async (userId, { limit = 50 } = {}) => {
    const [rows] = await db.query(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      [userId, Number(limit)]
    );
    return rows;
  },

  unreadCountForUser: async (userId) => {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0`,
      [userId]
    );
    return Number(rows[0]?.cnt || 0);
  },

  markRead: async (id, userId) => {
    const [result] = await db.query(
      `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    return result;
  },

  markAllRead: async (userId) => {
    const [result] = await db.query(
      `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`,
      [userId]
    );
    return result;
  }
};

module.exports = Notification;
