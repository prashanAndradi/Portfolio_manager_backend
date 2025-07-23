const bcrypt = require('bcrypt');
const User = require('../models/userModel');
const AuthorizerAssignment = require('../models/authorizerAssignmentModel');

// User registration with role selection
exports.register = async (req, res) => {
  try {
    const { username, password, role, allowed_tabs } = req.body;
    
    // Static admin account check
    if (username === 'admin' && password === 'Admin@321') {
      return res.json({
        success: true,
        user: {
          id: 0,
          username: 'admin',
          role: 'admin',
          token: 'static-admin-token',
          allowed_tabs: [
            'transactions',
            'isin_master',
            'fixed_income_gsec',
            'fixed_income_others',
            'payments_rtgs',
            'payments_other',
            'repo',
            'reverse_repo'
          ]
        }
      });
    }
    
    // Validate role
    const allowedRoles = ['user', 'authorizer', 'limits_allocating_user', 'limits_allocating_authorizer'];
    if (!allowedRoles.includes(role)) {
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
      role,
      allowed_tabs: Array.isArray(allowed_tabs) ? allowed_tabs : []
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
      role: user.role,
      allowed_tabs: user.allowed_tabs
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

exports.login = async (req, res) => {
  try {
    console.log('LOGIN ATTEMPT:', req.body);
    const { username, password } = req.body;
    
    // Static admin check
    if (username === 'admin' && password === 'Admin@321') {
      console.log('Admin login successful');
      const adminPayload = { id: 0, username: 'admin', role: 'admin' };
      const token = jwt.sign(adminPayload, JWT_SECRET, { expiresIn: '1d' });
      return res.json({
        success: true,
        user: adminPayload,
        token
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
    
    // Check for authorizer assignment and override role if present
    let effectiveRole = user.role;
    let allowedTabs = user.allowed_tabs || [];
    // Fetch all assignments for this user
    const [assignments] = await require('../config/db').query('SELECT * FROM authorizer_assignments WHERE user_id = ?', [user.id]);
    if (assignments && assignments.length > 0) {
      // Priority: back_office_final > back_office_verifier > back_office > front_office > authorizer > others
      const rolePriority = ['back_office_final', 'back_office_verifier', 'back_office', 'front_office', 'authorizer'];
      let bestAssignment = assignments[0];
      for (const role of rolePriority) {
        const found = assignments.find(a => a.role === role);
        if (found) {
          bestAssignment = found;
          break;
        }
      }
      effectiveRole = bestAssignment.role;
      // allowed_pages is a JSON string or array
      if (bestAssignment.allowed_pages) {
        try {
          allowedTabs = Array.isArray(bestAssignment.allowed_pages) ? bestAssignment.allowed_pages : JSON.parse(bestAssignment.allowed_pages);
        } catch {
          allowedTabs = [bestAssignment.allowed_pages];
        }
      }
    }
    
    console.log('Login successful for:', username);
    const userPayload = {
      id: user.id,
      username: user.username,
      role: effectiveRole
    };
    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '1d' });
    res.json({
      success: true,
      user: {
        ...userPayload,
        allowed_tabs: allowedTabs
      },
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
};
