const bcrypt = require('bcrypt');
const crypto = require('crypto');
const User = require('../models/userModel');
const AuthorizerAssignment = require('../models/authorizerAssignmentModel');
const emailService = require('../utils/emailService');
const { validatePassword } = require('../utils/passwordValidator');

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
    // Never log req.body here - it contains the plain-text password, which
    // would then sit in the PM2 log files in clear text.
    console.log('LOGIN ATTEMPT for user:', req.body?.username);
    const { username, password } = req.body;
    
    // Static admin check
    if (username === 'admin' && password === 'Admin@321') {
      console.log('Admin login successful');
      const adminPayload = { id: 0, username: 'admin', role: 'admin' };
      const token = jwt.sign(adminPayload, JWT_SECRET, { expiresIn: '7d' });
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
    
    const { resolveEffectiveWorkflowAuth } = require('../utils/effectiveWorkflowAuth');
    const actor = await resolveEffectiveWorkflowAuth(user.id);
    let effectiveRole = actor ? actor.role : user.role;
    let allowedTabs = actor ? actor.allowedTabs : (user.allowed_tabs || []);
    
    console.log('Login successful for:', username);
    const userPayload = {
      id: user.id,
      username: user.username, // Ensure username is always included
      role: effectiveRole,
      originalRole: user.role, // Keep original role for reference
      assignments: actor ? actor.assignments : []
    };
    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '7d' });
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

// Password reset request - sends email with reset token
exports.forgotPassword = async (req, res) => {
  try {
    const { email, username } = req.body;
    
    if (!email && !username) {
      return res.status(400).json({
        success: false,
        error: 'Email or username is required'
      });
    }

    // Find user by email or username
    let user;
    if (email) {
      const [users] = await require('../config/database').query(
        'SELECT id, username, email FROM users WHERE email = ?',
        [email]
      );
      user = users[0];
    } else {
      user = await User.findByUsername(username);
    }

    // Always return success message to prevent user enumeration
    const successMessage = 'If a matching account is found, a password reset link has been sent to the registered email address.';

    if (!user) {
      return res.status(200).json({
        success: true,
        message: successMessage
      });
    }

    // Check rate limiting (max 3 requests per hour per user)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [recentRequests] = await require('../config/database').query(
      'SELECT COUNT(*) as count FROM users WHERE id = ? AND resetPasswordExpires > ?',
      [user.id, oneHourAgo]
    );

    const maxAttempts = parseInt(process.env.MAX_RESET_ATTEMPTS_PER_HOUR) || 3;
    if (recentRequests[0]?.count >= maxAttempts) {
      // Still return success to prevent enumeration, but log the attempt
      console.warn(`Rate limit exceeded for password reset: user ${user.id}`);
      return res.status(200).json({
        success: true,
        message: successMessage
      });
    }

    // Generate secure reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedResetToken = await bcrypt.hash(resetToken, 10);
    
    // Set expiration time
    const expirationHours = parseInt(process.env.PASSWORD_RESET_TOKEN_EXPIRE_HOURS) || 1;
    const resetPasswordExpires = new Date(Date.now() + expirationHours * 60 * 60 * 1000);

    // Store hashed token in database
    await require('../config/database').query(
      'UPDATE users SET resetPasswordToken = ?, resetPasswordExpires = ? WHERE id = ?',
      [hashedResetToken, resetPasswordExpires, user.id]
    );

    // Send reset email if user has email
    if (user.email || email) {
      const userEmail = user.email || email;
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

      try {
        await emailService.sendPasswordResetEmail(userEmail, resetUrl, {
          expirationHours
        });
        console.log(`Password reset email sent to ${userEmail}`);
      } catch (emailError) {
        console.error('Failed to send password reset email:', emailError);
        // Don't expose email sending errors to prevent information disclosure
      }
    }

    res.status(200).json({
      success: true,
      message: successMessage
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during password reset request'
    });
  }
};

// Reset password using token from email
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Reset token and new password are required'
      });
    }

    // Validate new password
    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Password does not meet security requirements',
        details: validation.errors
      });
    }

    // Find user with valid reset token
    const [users] = await require('../config/database').query(
      'SELECT id, username, email, resetPasswordToken FROM users WHERE resetPasswordExpires > NOW()',
      []
    );

    // Check if any user has a matching hashed token
    let matchedUser = null;
    for (const user of users) {
      if (user.resetPasswordToken && await bcrypt.compare(token, user.resetPasswordToken)) {
        matchedUser = user;
        break;
      }
    }

    if (!matchedUser) {
      return res.status(400).json({
        success: false,
        error: 'Password reset token is invalid or has expired'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear reset token
    await require('../config/database').query(
      'UPDATE users SET password = ?, resetPasswordToken = NULL, resetPasswordExpires = NULL WHERE id = ?',
      [hashedPassword, matchedUser.id]
    );

    // Send confirmation email if user has email
    if (matchedUser.email) {
      try {
        await emailService.sendPasswordChangedNotificationEmail(matchedUser.email);
      } catch (emailError) {
        console.error('Failed to send password change notification:', emailError);
        // Don't fail the password reset if email notification fails
      }
    }

    console.log(`Password reset successful for user: ${matchedUser.username}`);
    
    res.status(200).json({
      success: true,
      message: 'Password has been reset successfully'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during password reset'
    });
  }
};

// Change password for authenticated user
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }

    // Validate new password
    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Password does not meet security requirements',
        details: validation.errors
      });
    }

    // Get user with current password
    const [users] = await require('../config/database').query(
      'SELECT id, username, email, password FROM users WHERE id = ?',
      [userId]
    );

    const user = users[0];
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, user.password);
    if (!passwordMatch) {
      return res.status(400).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    // Check if new password is different from current
    const samePassword = await bcrypt.compare(newPassword, user.password);
    if (samePassword) {
      return res.status(400).json({
        success: false,
        error: 'New password must be different from current password'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await require('../config/database').query(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, userId]
    );

    // Send notification email if user has email
    if (user.email) {
      try {
        await emailService.sendPasswordChangedNotificationEmail(user.email);
      } catch (emailError) {
        console.error('Failed to send password change notification:', emailError);
        // Don't fail the password change if email notification fails
      }
    }

    console.log(`Password changed successfully for user: ${user.username}`);

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during password change'
    });
  }
};
