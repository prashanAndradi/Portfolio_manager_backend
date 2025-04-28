const Account = require('../models/accountModel');

// Get all accounts
exports.getAllAccounts = async (req, res) => {
  try {
    const accounts = await Account.getAll();
    res.status(200).json({
      success: true,
      data: accounts
    });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch accounts',
      error: error.message
    });
  }
};

// Get account by ID
exports.getAccountById = async (req, res) => {
  try {
    const id = req.params.id;
    const account = await Account.getById(id);
    
    if (!account) {
      return res.status(404).json({
        success: false,
        message: `Account with id ${id} not found`
      });
    }
    
    res.status(200).json({
      success: true,
      data: account
    });
  } catch (error) {
    console.error(`Error fetching account ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch account',
      error: error.message
    });
  }
};

// Create account
exports.createAccount = async (req, res) => {
  try {
    const { name, balance } = req.body;
    
    // Basic validation
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Account name is required'
      });
    }
    
    const newAccount = await Account.create({
      name,
      balance: balance || 0
    });
    
    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: newAccount
    });
  } catch (error) {
    console.error('Error creating account:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create account',
      error: error.message
    });
  }
};

// Update account
exports.updateAccount = async (req, res) => {
  try {
    const id = req.params.id;
    const { name, balance } = req.body;
    
    // Check if account exists
    const account = await Account.getById(id);
    if (!account) {
      return res.status(404).json({
        success: false,
        message: `Account with id ${id} not found`
      });
    }
    
    // Basic validation
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Account name is required'
      });
    }
    
    // Update account
    const updatedAccount = await Account.update(id, {
      name,
      balance: balance !== undefined ? balance : account.balance
    });
    
    res.status(200).json({
      success: true,
      message: 'Account updated successfully',
      data: updatedAccount
    });
  } catch (error) {
    console.error(`Error updating account ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to update account',
      error: error.message
    });
  }
};

// Delete account
exports.deleteAccount = async (req, res) => {
  try {
    const id = req.params.id;
    
    // Check if account exists
    const account = await Account.getById(id);
    if (!account) {
      return res.status(404).json({
        success: false,
        message: `Account with id ${id} not found`
      });
    }
    
    await Account.delete(id);
    
    res.status(200).json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    console.error(`Error deleting account ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account',
      error: error.message
    });
  }
}; 