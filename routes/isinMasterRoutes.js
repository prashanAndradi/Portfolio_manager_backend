const express = require('express');
const router = express.Router();
const isinMasterController = require('../controllers/isinMasterController');

router.post('/', isinMasterController.createIsin);
router.get('/', isinMasterController.getAllIsins);

module.exports = router;
