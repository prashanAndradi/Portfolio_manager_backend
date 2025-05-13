const express = require('express');
const { getAllUsers, updateUserTabs } = require('../controllers/userController');
const router = express.Router();

router.get('/', getAllUsers);
router.put('/:id/tabs', updateUserTabs);

module.exports = router;
