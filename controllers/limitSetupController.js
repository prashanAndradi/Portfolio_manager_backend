const LimitSetup = require('../models/limitSetupModel');

exports.getAllCounterparties = async (req, res) => {
  try {
    const results = await LimitSetup.getAllCounterparties();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};

exports.createLimit = async (req, res) => {
  try {
    const result = await LimitSetup.create(req.body);
    res.status(201).json({ id: result.insertId, ...req.body });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};
