const express = require('express');
const router = express.Router();
const dealerLimitController = require('../controllers/dealerLimitController');
const { checkAuth } = require('../middleware/auth');
const { requireMiddleOffice, requireMiddleOfficeApprover } = require('../middleware/requireMiddleOffice');

// Dealer limits (per front-office user) are a middle-office-managed setup
// page, same restriction as counterparty master - only middle_office_* or
// admin may view/manage them. A plain middle_office_user's create/update is
// staged as a pending proposal by the controller; only officer/manager (or
// admin) may approve/reject it via the two routes below.
router.get('/', checkAuth, requireMiddleOffice, dealerLimitController.getAll);
router.get('/pending', checkAuth, requireMiddleOfficeApprover, dealerLimitController.getPending);
router.post('/', checkAuth, requireMiddleOffice, dealerLimitController.createOrUpdate);
router.patch('/:id/approve', checkAuth, requireMiddleOfficeApprover, dealerLimitController.approve);
router.patch('/:id/reject', checkAuth, requireMiddleOfficeApprover, dealerLimitController.reject);
router.delete('/:id', checkAuth, requireMiddleOffice, dealerLimitController.remove);

module.exports = router;
