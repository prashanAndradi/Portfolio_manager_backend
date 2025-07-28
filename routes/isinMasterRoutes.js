const express = require('express');
const router = express.Router();
const isinMasterController = require('../controllers/isinMasterController');

router.post('/', isinMasterController.createIsin);
router.get('/', isinMasterController.getAllIsins);
router.get('/search', isinMasterController.searchIsins);

router.get('/:id', isinMasterController.getIsinById);

// Get previous and next coupon dates for an ISIN
router.get('/:isin/coupon-dates', isinMasterController.getCouponDates);
// Get all coupon months/days (MM/DD) for an ISIN
router.get('/:isin/coupon-months', isinMasterController.getCouponMonths);

/**
 * @swagger
 * /isin-master/gsec:
 *   post:
 *     summary: Create a new G-Sec (Government Securities) transaction
 *     tags: [Fixed Income G-Sec]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tradeDate
 *               - securityCode
 *               - faceValue
 *               - counterpartyId
 *               - price
 *               - settlementDate
 *             properties:
 *               tradeDate:
 *                 type: string
 *                 example: '2025-07-28'
 *               securityCode:
 *                 type: string
 *                 example: 'IN0020220010'
 *               faceValue:
 *                 type: number
 *                 example: 1000000
 *               counterpartyId:
 *                 type: integer
 *                 example: 5
 *               price:
 *                 type: number
 *                 example: 99.8750
 *               settlementDate:
 *                 type: string
 *                 example: '2025-07-30'
 *               remarks:
 *                 type: string
 *                 example: 'Auction allotment'
 *     responses:
 *       201:
 *         description: G-Sec transaction created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 id:
 *                   type: integer
 *                 dealNumber:
 *                   type: string
 *       400:
 *         description: Invalid input
 */
// Gsec transaction routes
router.post('/gsec', isinMasterController.saveGsec);

/**
 * @swagger
 * /isin-master/gsec/recent:
 *   get:
 *     summary: Get recent G-Sec transactions
 *     tags: [Fixed Income G-Sec]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of recent G-Sec transactions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 */
// Get recent Gsec transactions
router.get('/gsec/recent', isinMasterController.getRecentGsecTransactions);

/**
 * @swagger
 * /isin-master/gsec-latest-deal-number:
 *   get:
 *     summary: Get latest deal number for G-Sec transactions up to a given date
 *     tags: [Fixed Income G-Sec]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *         description: Date up to which to fetch the latest deal number (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Latest deal number
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 dealNumber:
 *                   type: string
 *       400:
 *         description: Invalid input
 */
// Get latest deal number for Gsec transactions up to a given date
router.get('/gsec-latest-deal-number', isinMasterController.getGsecLatestDealNumber);

/**
 * @swagger
 * /isin-master/gsec/{id}:
 *   put:
 *     summary: Update a G-Sec transaction
 *     tags: [Fixed Income G-Sec]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: G-Sec transaction ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               price:
 *                 type: number
 *                 example: 99.9000
 *               remarks:
 *                 type: string
 *                 example: 'Price updated after auction'
 *     responses:
 *       200:
 *         description: G-Sec transaction updated
 *       404:
 *         description: G-Sec transaction not found
 */
// Update Gsec transaction
router.put('/gsec/:id', isinMasterController.updateGsecTransaction);

/**
 * @swagger
 * /isin-master/gsec/{id}/status:
 *   put:
 *     summary: Update G-Sec transaction status (approve/reject)
 *     tags: [Fixed Income G-Sec]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: G-Sec transaction ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [approved, rejected]
 *                 example: approved
 *               remarks:
 *                 type: string
 *                 example: 'Approved by supervisor'
 *     responses:
 *       200:
 *         description: G-Sec transaction status updated
 *       404:
 *         description: G-Sec transaction not found
 */
// Update Gsec transaction status (approve/reject)
router.put('/gsec/:id/status', isinMasterController.updateGsecTransactionStatus);

module.exports = router;
