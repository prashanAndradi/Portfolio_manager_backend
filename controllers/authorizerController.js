// controllers/authorizerController.js
const AuthorizerAssignment = require('../models/authorizerAssignmentModel');
const User = require('../models/userModel');

// Get all authorizer assignments
exports.getAllAssignments = async (req, res) => {
  try {
    const assignments = await AuthorizerAssignment.getAll();
    res.json({ assignments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Create or update an authorizer assignment
exports.createAssignment = async (req, res) => {
  try {
    const { user_id, role, per_deal_limit, per_day_limit, allowed_pages } = req.body;
    const assignment = await AuthorizerAssignment.createOrUpdate({ user_id, role, per_deal_limit, per_day_limit, allowed_pages });
    res.json({ assignment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get all users (for admin dropdown)
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.findAll({ attributes: ['id', 'username'] });
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
