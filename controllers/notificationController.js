const Notification = require('../models/notificationModel');
const { resolveRequestUserId } = require('../utils/requestUser');

exports.list = async (req, res) => {
  try {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const rows = await Notification.listForUser(userId, { limit: req.query.limit || 50 });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
};

exports.unreadCount = async (req, res) => {
  try {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const count = await Notification.unreadCountForUser(userId);
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
};

exports.markRead = async (req, res) => {
  try {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const result = await Notification.markRead(req.params.id, userId);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    await Notification.markAllRead(userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
};
