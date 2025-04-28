const Security = require('../models/securityModel');

exports.getAllSecurities = (req, res) => {
  Security.getAll((err, results) => {
    if (err) return res.status(500).json({ error: err });
    res.json(results);
  });
};

exports.getSecurityById = (req, res) => {
  Security.getById(req.params.id, (err, result) => {
    if (err) return res.status(500).json({ error: err });
    res.json(result[0]);
  });
};

exports.createSecurity = (req, res) => {
  Security.create(req.body, (err, result) => {
    if (err) return res.status(500).json({ error: err });
    res.status(201).json({ id: result.insertId, ...req.body });
  });
};

exports.updateSecurity = (req, res) => {
  Security.update(req.params.id, req.body, (err) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ id: req.params.id, ...req.body });
  });
};

exports.deleteSecurity = (req, res) => {
  Security.delete(req.params.id, (err) => {
    if (err) return res.status(500).json({ error: err });
    res.status(204).end();
  });
};
