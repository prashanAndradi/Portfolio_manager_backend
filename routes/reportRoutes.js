const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');

// GSec report endpoint
router.get('/gsec', reportController.getGsecReport);

module.exports = router;
