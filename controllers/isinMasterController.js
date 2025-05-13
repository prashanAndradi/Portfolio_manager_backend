const IsinMaster = require('../models/isinMasterModel');

exports.createIsin = (req, res) => {
  IsinMaster.create(req.body, (err, result) => {
    if (err) return res.status(500).json({ success: false, error: err });
    res.json({ success: true, id: result.insertId });
  });
};

exports.getAllIsins = (req, res) => {
  IsinMaster.getAll((err, results) => {
    if (err) return res.status(500).json({ success: false, error: err });
    res.json({ success: true, data: results });
  });
};
