const express = require('express');
const router = express.Router();
const db = require('../models/gsec'); // Adjust if your DB/model import is different

// GET /api/gsec?approval_level=1 - fetch all GSec transactions at a given approval level
// GET /api/gsec?approval_level=1 - fetch all GSec transactions at a given approval level
router.get('/', async (req, res) => {
  const approvalLevel = req.query.approval_level;
  try {
    const transactions = await db.getTransactionsByApprovalLevel(approvalLevel);
    res.json(transactions);
  } catch (err) {
    console.error('Error fetching GSec transactions:', err);
    res.status(500).json({ error: 'Failed to fetch GSec transactions' });
  }
});

// POST /api/gsec/:id/approve - advance approval level for a transaction
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

module.exports = router;
