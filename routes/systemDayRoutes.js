const express = require('express');
const router = express.Router();
const { getSystemDay, setSystemDay } = require('../models/systemDayModel');
const { checkAuth, checkAdmin } = require('../middleware/auth');

/**
 * @swagger
 * /system-day:
 *   get:
 *     summary: Get current system day
 *     description: Returns the current system day (public endpoint).
 *     tags: [System Day]
 *     responses:
 *       200:
 *         description: Current system day
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 system_day:
 *                   type: string
 *       404:
 *         description: System day not found
 */
// GET /api/system-day - get current system day
router.get('/', async (req, res) => {
  try {
    const day = await getSystemDay();
    if (!day) return res.status(404).json({ success: false, message: 'System day not found' });
    res.json({ success: true, system_day: day.system_date });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /system-day:
 *   post:
 *     summary: Set system day
 *     description: Sets the system day (admin only, requires JWT).
 *     tags: [System Day]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - system_date
 *             properties:
 *               system_date:
 *                 type: string
 *                 example: '2025-07-27'
 *     responses:
 *       200:
 *         description: System day updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 system_day:
 *                   type: string
 *       400:
 *         description: system_date required
 *       401:
 *         description: Unauthorized or forbidden
 */
// POST /api/system-day - set system day (admin only)
router.post('/', checkAuth, checkAdmin, async (req, res) => {
  try {
    const { system_date } = req.body;
    if (!system_date) return res.status(400).json({ success: false, message: 'system_date required' });
    await setSystemDay(system_date);
    res.json({ success: true, system_day: system_date });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
