const CounterpartyCorporate = require('../models/counterpartyCorporateModel');

exports.createCounterpartyCorporate = async (req, res) => {
  try {
    const result = await CounterpartyCorporate.create(req.body);
    res.status(201).json({ 
      id: result.insertId, 
      cux_number: result.cux_number,
      ...req.body 
    });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};

exports.getAllCounterpartyCorporates = async (req, res) => {
  try {
    const results = await CounterpartyCorporate.getAll();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};

exports.getCounterpartyCorporateById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await CounterpartyCorporate.getById(id);
    if (!result) {
      return res.status(404).json({ error: 'Counterparty not found' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};

exports.updateCounterpartyCorporate = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await CounterpartyCorporate.update(id, req.body);
    res.json({ success: true, message: 'Counterparty updated successfully', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};
