const express = require('express');
const router = express.Router();
const db = require('../models/gsec'); // Adjust if your DB/model import is different
const gsecLetterController = require('../controllers/gsecLetterController');
const { checkAuth, checkRoles } = require('../middleware/auth');

const GSEC_LETTER_ROLES = ['back_office_verifier', 'back_office_final', 'admin'];

/**
 * @swagger
 * /api/gsec:
 *   get:
 *     summary: Get GSEC transactions
 *     description: Fetch GSEC transactions filtered by portfolio or approval level. If no filter is provided, returns all transactions.
 *     tags: [GSEC]
 *     parameters:
 *       - in: query
 *         name: portfolio
 *         required: false
 *         schema:
 *           type: string
 *         description: Portfolio code or identifier to filter transactions
 *       - in: query
 *         name: approval_level
 *         required: false
 *         schema:
 *           type: integer
 *         description: Approval level to filter transactions (e.g., 1, 2, 3)
 *     responses:
 *       200:
 *         description: GSEC transactions fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Failed to fetch GSEC transactions
 */
router.get('/', async (req, res) => {
  const { portfolio, approval_level } = req.query;
  try {
    let transactions;
    if (portfolio) {
      transactions = await db.getTransactionsByPortfolio(portfolio);
    } else if (approval_level) {
      transactions = await db.getTransactionsByApprovalLevel(approval_level);
    } else {
      // No filter given: return the most recent deals. The model has no
      // fetch-all method (this used to call a non-existent
      // db.getAllTransactions(), so every unfiltered request 500'd);
      // getRecent() returns the latest 150 with counterparty names joined.
      transactions = await db.getRecent();
    }
    res.json(transactions);
  } catch (err) {
    console.error('Error fetching GSec transactions:', err);
    res.status(500).json({ error: 'Failed to fetch GSec transactions' });
  }
});

/**
 * @swagger
 * /api/gsec/{id}/approve:
 *   post:
 *     summary: Approve a GSEC transaction
 *     description: Advance the approval level for a given GSEC transaction.
 *     tags: [GSEC]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Transaction ID
 *     responses:
 *       200:
 *         description: Transaction approved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Failed to approve transaction
 */
router.post('/:id/approve', async (req, res) => {
  const { id } = req.params;
  try {
    const updatedTx = await db.advanceApprovalLevel(id);
    if (!updatedTx) return res.status(404).json({ error: 'Transaction not found' });
    res.json(updatedTx);
  } catch (err) {
    console.error('Error approving GSec transaction:', err);
    res.status(500).json({ error: 'Failed to approve transaction' });
  }
});

/**
 * @swagger
 * /api/gsec/buy-deals:
 *   get:
 *     summary: Get GSEC buy deals
 *     description: Fetch only the Buy GSEC deals.
 *     tags: [GSEC]
 *     responses:
 *       200:
 *         description: Buy GSEC deals fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Failed to fetch Buy GSEC deals
 */
router.get('/buy-deals', async (req, res) => {
  try {
    const deals = await db.getBuyDeals();
    res.json({ success: true, data: deals });
  } catch (err) {
    console.error('Error fetching Buy GSec deals:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch Buy GSec deals' });
  }
});

/**
 * @swagger
 * /api/gsec/buy-deals-with-balance:
 *   get:
 *     summary: Get GSEC buy deals with remaining balance
 *     description: Fetch Buy GSEC deals including remaining face value (balance).
 *     tags: [GSEC]
 *     responses:
 *       200:
 *         description: Buy GSEC deals with balance fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Failed to fetch Buy GSEC deals with balance
 */
router.get('/buy-deals-with-balance', async (req, res) => {
  try {
    const deals = await db.getBuyDealsWithBalance();
    res.json({ success: true, data: deals });
  } catch (err) {
    console.error('Error fetching Buy GSec deals with balance:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch Buy GSec deals with balance' });
  }
});

/**
 * @swagger
 * /api/gsec/{id}/letter:
 *   get:
 *     summary: Get GSEC instruction letter data (JSON)
 *     description: Returns resolved letter fields for a GSEC deal. The letter scenario (DVP/DVF/RVP/RVF) is derived from transaction_type and fund_movement.
 *     tags: [GSEC]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Deal not found }
 */
router.get(
  '/:id/letter',
  checkAuth,
  checkRoles(...GSEC_LETTER_ROLES),
  gsecLetterController.getLetterData
);

/**
 * @swagger
 * /api/gsec/{id}/letter/html:
 *   get:
 *     summary: Get GSEC instruction letter as renderable HTML
 *     description: Returns the full HTML document for the GSEC letter, suitable for opening in a new tab or iframe for printing.
 *     tags: [GSEC]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: HTML document }
 *       404: { description: Deal not found }
 */
router.get(
  '/:id/letter/html',
  checkAuth,
  checkRoles(...GSEC_LETTER_ROLES),
  gsecLetterController.getLetterHtml
);

module.exports = router;
