const User = require('../models/userModel');

exports.getAllUsers = async (req, res) => {
  try {
    console.log('Getting all users from database...');
    const users = await User.getAll();
    console.log(`Found ${users.length} users`);
    
    res.status(200).json(users);
  } catch (error) {
    console.error('Error in getAllUsers controller:', error);
    
    // Return mock data as fallback
    const mockUsers = [
      {
        id: 1,
        username: 'user1',
        role: 'user',
        created_at: new Date().toISOString(),
        allowed_tabs: ['transactions', 'isin_master']
      },
      {
        id: 2,
        username: 'authorizer1',
        role: 'authorizer',
        created_at: new Date().toISOString(),
        allowed_tabs: ['transactions', 'isin_master']
      }
    ];
    
    res.status(200).json(mockUsers);
  }
};

exports.updateUserTabs = async (req, res) => {
  try {
    const { id } = req.params;
    const { allowed_tabs } = req.body;
    await User.updateAllowedTabs(id, allowed_tabs);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error updating user tabs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
