const bcrypt = require('bcrypt');
const User = require('../models/userModel');

// User registration with role selection
exports.register = async (req, res) => {
  try {
    const { username, password, role } = req.body;
    
    // Static admin account check
    if (username === 'admin' && password === 'Admin@321') {
      return res.json({
        success: true,
        user: {
          id: 0,
          username: 'admin',
          role: 'admin',
          token: 'static-admin-token'
        }
      });
    }
    
    // Validate role
    if (!['user', 'authorizer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    // Check if username already exists
    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      return res.status(400).json({ 
        success: false,
        error: 'Username already exists' 
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = await User.create({
      username,
      password: hashedPassword,
      role
    });
    
    // Check if user creation was successful
    if (!user?.id) {
      return res.status(500).json({
        success: false,
        error: 'User creation failed in database'
      });
    }
    
    res.status(201).json({ 
      id: user.id,
      username: user.username,
      role: user.role
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    console.log('LOGIN ATTEMPT:', req.body);
    const { username, password } = req.body;
    
    // Static admin check
    if (username === 'admin' && password === 'Admin@321') {
      console.log('Admin login successful');
      return res.json({
        success: true,
        user: {
          id: 0,
          username: 'admin',
          role: 'admin',
          token: 'static-admin-token'
        }
      });
    }
    
    // Regular user/authorizer login
    console.log('Checking database for user:', username);
    const user = await User.findByUsername(username);
    if (!user) {
      console.log('User not found:', username);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      console.log('Password incorrect for user:', username);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    console.log('Login successful for:', username);
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
};
