const express = require('express');
const router = express.Router();
const { getSystemDay, setSystemDay } = require('../models/systemDayModel');
const { checkAuth, checkAdmin } = require('../middleware/auth');

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
