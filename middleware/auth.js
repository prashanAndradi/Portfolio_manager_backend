const jwt = require('jsonwebtoken');
const db = require('../config/database');

// Check if user is authenticated
exports.checkAuth = (req, res, next) => {
  try {
    // For development/testing, allow requests without authentication
    if (process.env.NODE_ENV === 'development' && process.env.SKIP_AUTH === 'true') {
      console.log('Skipping authentication in development mode');
      return next();
    }
    
    // Get token from header
    const token = req.headers.authorization?.split(' ')[1];
    
    // If no token, check if there's user data in headers (for testing)
    if (!token && req.headers['x-user-data']) {
      try {
        const userData = JSON.parse(req.headers['x-user-data']);
        req.user = userData;
        return next();
      } catch (error) {
        console.error('Error parsing x-user-data:', error);
      }
    }
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access denied. No token provided.' 
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    
    // For development/testing, allow requests even if token verification fails
    if (process.env.NODE_ENV === 'development' && process.env.SKIP_AUTH === 'true') {
      console.log('Continuing despite auth error in development mode');
      return next();
    }
    
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid token.', 
      error: error.message 
    });
  }
};

// Check if user is an admin
exports.checkAdmin = (req, res, next) => {
  try {
    // For development/testing, allow requests without admin check
    if (process.env.NODE_ENV === 'development' && process.env.SKIP_AUTH === 'true') {
      console.log('Skipping admin check in development mode');
      return next();
    }
    
    // If user was set by checkAuth middleware
    if (req.user && (req.user.role === 'admin' || req.user.isAdmin)) {
      return next();
    }
    
    // If user data is in headers (for testing)
    if (req.headers['x-user-data']) {
      try {
        const userData = JSON.parse(req.headers['x-user-data']);
        if (userData.role === 'admin' || userData.isAdmin) {
          return next();
        }
      } catch (error) {
        console.error('Error parsing x-user-data:', error);
      }
    }
    
    return res.status(403).json({ 
      success: false, 
      message: 'Access denied. Admin privileges required.' 
    });
  } catch (error) {
    console.error('Admin check middleware error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error during authorization check.', 
      error: error.message 
    });
  }
};

// Check if user is an authorizer
exports.checkAuthorizer = (req, res, next) => {
  try {
    // For development/testing, allow requests without authorizer check
    if (process.env.NODE_ENV === 'development' && process.env.SKIP_AUTH === 'true') {
      console.log('Skipping authorizer check in development mode');
      return next();
    }
    
    // If user was set by checkAuth middleware
    if (req.user && (req.user.role === 'authorizer' || req.user.role === 'admin')) {
      return next();
    }
    
    // If user data is in headers (for testing)
    if (req.headers['x-user-data']) {
      try {
        const userData = JSON.parse(req.headers['x-user-data']);
        if (userData.role === 'authorizer' || userData.role === 'admin') {
          return next();
        }
      } catch (error) {
        console.error('Error parsing x-user-data:', error);
      }
    }
    
    return res.status(403).json({ 
      success: false, 
      message: 'Access denied. Authorizer privileges required.' 
    });
  } catch (error) {
    console.error('Authorizer check middleware error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error during authorization check.', 
      error: error.message 
    });
  }
};
