const TransactionType = require('../models/transactionTypeModel');

exports.getAllTransactionTypes = (req, res) => {
  TransactionType.getAll((err, results) => {
    if (err) return res.status(500).json({ error: err });
    res.json(results);
  });
};

exports.getTransactionTypeById = (req, res) => {
  TransactionType.getById(req.params.id, (err, result) => {
    if (err) return res.status(500).json({ error: err });
    res.json(result[0]);
  });
};

exports.createTransactionType = (req, res) => {
  TransactionType.create(req.body, (err, result) => {
    if (err) return res.status(500).json({ error: err });
    res.status(201).json({ id: result.insertId, ...req.body });
  });
};

exports.updateTransactionType = (req, res) => {
  TransactionType.update(req.params.id, req.body, (err) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ id: req.params.id, ...req.body });
  });
};

exports.deleteTransactionType = (req, res) => {
  TransactionType.delete(req.params.id, (err) => {
    if (err) return res.status(500).json({ error: err });
    res.status(204).end();
  });
};
