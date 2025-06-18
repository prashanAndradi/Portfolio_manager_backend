// Controller for Settlement Account Master
const SettlementAccount = require('../models/settlementAccountModel');

exports.createSettlementAccount = async (req, res) => {
  try {
    const id = await SettlementAccount.create(req.body);
    res.status(201).json({ success: true, id });
  } catch (error) {
    console.error('Error creating settlement account:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getSettlementAccounts = async (req, res) => {
  try {
    const search = req.query.q || '';
    const accounts = await SettlementAccount.find(search);
    res.json({ success: true, data: accounts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateSettlementAccount = async (req, res) => {
  try {
    await SettlementAccount.update(req.params.id, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
