const CounterpartyIndividual = require('../models/counterpartyIndividualModel');

exports.createCounterpartyIndividual = async (req, res) => {
  try {
    const result = await CounterpartyIndividual.create(req.body);
    res.status(201).json({ id: result.insertId, ...req.body });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};

exports.getAllCounterpartyIndividuals = async (req, res) => {
  try {
    const results = await CounterpartyIndividual.getAll();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};
