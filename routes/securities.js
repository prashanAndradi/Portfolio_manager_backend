const express = require('express');
const router = express.Router();
const securityController = require('../controllers/securityController');

router.get('/', securityController.getAllSecurities);
router.get('/:id', securityController.getSecurityById);
router.post('/', securityController.createSecurity);
router.put('/:id', securityController.updateSecurity);
router.delete('/:id', securityController.deleteSecurity);

module.exports = router;
