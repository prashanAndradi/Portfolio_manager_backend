const CounterpartyIndividual = require('../models/counterpartyIndividualModel');

exports.createCounterpartyIndividual = (req, res) => {
  CounterpartyIndividual.create(req.body, (err, result) => {
    if (err) return res.status(500).json({ error: err });
    res.status(201).json({ id: result.insertId, ...req.body });
  });
};

exports.getAllCounterpartyIndividuals = (req, res) => {
  CounterpartyIndividual.getAll((err, results) => {
    if (err) return res.status(500).json({ error: err });
    res.json(results);
  });
};
