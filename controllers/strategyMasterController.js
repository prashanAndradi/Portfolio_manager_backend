const StrategyMaster = require('../models/strategyMasterModel');

exports.getAll = async (req, res) => {
  try {
    const strategies = await StrategyMaster.getAll();
    res.json(strategies);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch strategies' });
  }
};

exports.getById = async (req, res) => {
  try {
    const strategy = await StrategyMaster.getById(req.params.id);
    if (!strategy) return res.status(404).json({ error: 'Not found' });
    res.json(strategy);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch strategy' });
  }
};

exports.create = async (req, res) => {
  try {
    const created = await StrategyMaster.create(req.body);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create strategy' });
  }
};

exports.update = async (req, res) => {
  try {
    const updated = await StrategyMaster.update(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update strategy' });
  }
};

exports.delete = async (req, res) => {
  try {
    await StrategyMaster.delete(req.params.id);
    res.json({});
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete strategy' });
  }
};
