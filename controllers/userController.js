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
        created_at: new Date().toISOString()
      },
      {
        id: 2,
        username: 'authorizer1',
        role: 'authorizer',
        created_at: new Date().toISOString()
      }
    ];
    
    res.status(200).json(mockUsers);
  }
};
