const Counterparty = require('../models/counterpartyModel');

exports.getAllCounterparties = async (req, res) => {
  try {
    const results = await Counterparty.getAll();
    res.json({ data: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getCounterpartyById = async (req, res) => {
  try {
    const result = await Counterparty.getById(req.params.id);
    if (!result) return res.status(404).json({ error: 'Counterparty not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createCounterparty = (req, res) => {
  Counterparty.create(req.body, (err, result) => {
    if (err) return res.status(500).json({ error: err });
    res.status(201).json({ id: result.insertId, ...req.body });
  });
};

exports.updateCounterparty = (req, res) => {
  Counterparty.update(req.params.id, req.body, (err) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ id: req.params.id, ...req.body });
  });
};

exports.deleteCounterparty = (req, res) => {
  Counterparty.delete(req.params.id, (err) => {
    if (err) return res.status(500).json({ error: err });
    res.status(204).end();
  });
};
