const CounterpartyJoint = require('../models/counterpartyJointModel');

exports.createCounterpartyJoint = (req, res) => {
  CounterpartyJoint.create(req.body, (err, result) => {
    if (err) return res.status(500).json({ error: err });
    res.status(201).json({ id: result.insertId, ...req.body });
  });
};
