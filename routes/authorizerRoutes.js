// routes/authorizerRoutes.js
const express = require('express');
const router = express.Router();
const authorizerController = require('../controllers/authorizerController');

router.get('/', authorizerController.getAllAssignments);
router.post('/', authorizerController.createAssignment);
router.get('/users', authorizerController.getAllUsers);

module.exports = router;
