const Counterparty = require('../models/counterpartyModel');

exports.getAllCounterparties = (req, res) => {
  Counterparty.getAll((err, results) => {
    if (err) return res.status(500).json({ error: err });
    res.json(results);
  });
};

exports.getCounterpartyById = (req, res) => {
  Counterparty.getById(req.params.id, (err, result) => {
    if (err) return res.status(500).json({ error: err });
    res.json(result[0]);
  });
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
