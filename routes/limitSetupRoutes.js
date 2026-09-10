const express = require('express');
const router = express.Router();
const limitSetupController = require('../controllers/limitSetupController');
const { checkAuth } = require('../middleware/auth');
const { requireMiddleOffice, requireMiddleOfficeApprover } = require('../middleware/requireMiddleOffice');

// Counterparty limit setup is a middle-office-managed page, same restriction
// as counterparty master and dealer limits. A plain middle_office_user's
// submission is staged as a pending proposal by the controller; only an
// officer/manager (or admin) may approve or reject it.

// Read-only counterparty list that populates the form's dropdown. Left
// unguarded beyond checkAuth because it is only names, and the page's own
// route guard already restricts who can reach it.
router.get('/limit-counterparties', checkAuth, limitSetupController.getAllCounterparties);

// Save a limit - applies immediately for officer/manager/admin, staged as a
// proposal for a middle_office_user.
router.post('/limits', checkAuth, requireMiddleOffice, limitSetupController.createLimit);

// Request blotter - any middle-office tier may view, but the controller
// scopes a plain middle_office_user to their own submissions.
router.get('/requests', checkAuth, requireMiddleOffice, limitSetupController.getRequests);

// Proposal queue and its actions.
router.get('/pending', checkAuth, requireMiddleOfficeApprover, limitSetupController.getPending);
router.patch('/:id/approve', checkAuth, requireMiddleOfficeApprover, limitSetupController.approve);
router.patch('/:id/reject', checkAuth, requireMiddleOfficeApprover, limitSetupController.reject);

module.exports = router;
