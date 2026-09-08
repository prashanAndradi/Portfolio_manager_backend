const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { checkAuth } = require('../middleware/auth');

// Every route is scoped to the caller's own notifications via
// resolveRequestUserId(req) inside the controller - no id-based access to
// another user's notifications exists.
router.get('/', checkAuth, notificationController.list);
router.get('/unread-count', checkAuth, notificationController.unreadCount);
router.patch('/:id/read', checkAuth, notificationController.markRead);
router.patch('/read-all', checkAuth, notificationController.markAllRead);

module.exports = router;
