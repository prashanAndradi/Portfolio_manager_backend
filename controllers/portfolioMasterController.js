const PortfolioMaster = require('../models/portfolioMasterModel');

exports.getAll = async (req, res) => {
  try {
    const portfolios = await PortfolioMaster.getAll();
    res.json(portfolios);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch portfolios' });
  }
};

exports.getById = async (req, res) => {
  try {
    const portfolio = await PortfolioMaster.getById(req.params.id);
    if (!portfolio) return res.status(404).json({ error: 'Not found' });
    res.json(portfolio);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
};

exports.create = async (req, res) => {
  try {
    const newPortfolio = await PortfolioMaster.create(req.body);
    res.status(201).json(newPortfolio);
  } catch (err) {
    console.error('PortfolioMaster create error:', err); // Log the error for debugging
    res.status(500).json({ error: 'Failed to create portfolio', details: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const updated = await PortfolioMaster.update(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update portfolio' });
  }
};

exports.delete = async (req, res) => {
  try {
    await PortfolioMaster.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete portfolio' });
  }
};
