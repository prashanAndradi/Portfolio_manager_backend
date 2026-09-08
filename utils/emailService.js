const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this.isConfigured = false;
    this.initializeTransporter();
  }

  initializeTransporter() {
    try {
      // Check if email configuration is available
      if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.warn('Email service not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables.');
        return;
      }

      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        // Additional options for better reliability
        pool: true,
        maxConnections: 1,
        rateDelta: 20000, // 20 seconds
        rateLimit: 5, // max 5 emails per rateDelta
      });

      this.isConfigured = true;
      console.log('Email service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize email service:', error);
      this.isConfigured = false;
    }
  }

  async verifyConnection() {
    if (!this.isConfigured) {
      throw new Error('Email service not configured');
    }

    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      console.error('Email service verification failed:', error);
      throw error;
    }
  }

  generatePasswordResetEmailHTML(resetUrl, expirationHours = 1) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset Request</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f4f4f4;
            }
            .container {
                background-color: #ffffff;
                padding: 30px;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .header {
                text-align: center;
                margin-bottom: 30px;
            }
            .logo {
                font-size: 24px;
                font-weight: bold;
                color: #2c3e50;
                margin-bottom: 10px;
            }
            .content {
                margin-bottom: 30px;
            }
            .reset-button {
                display: inline-block;
                background-color: #3498db;
                color: #ffffff;
                padding: 12px 30px;
                text-decoration: none;
                border-radius: 5px;
                font-weight: bold;
                margin: 20px 0;
            }
            .reset-button:hover {
                background-color: #2980b9;
            }
            .warning {
                background-color: #fff3cd;
                border: 1px solid #ffeaa7;
                color: #856404;
                padding: 15px;
                border-radius: 5px;
                margin: 20px 0;
            }
            .footer {
                font-size: 14px;
                color: #666;
                text-align: center;
                margin-top: 30px;
                padding-top: 20px;
                border-top: 1px solid #eee;
            }
            .security-note {
                font-size: 12px;
                color: #999;
                margin-top: 15px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">Portfolio Management System</div>
                <h2>Password Reset Request</h2>
            </div>
            
            <div class="content">
                <p>Hello,</p>
                
                <p>We received a request to reset the password for your account. If you made this request, please click the button below to set a new password:</p>
                
                <div style="text-align: center;">
                    <a href="${resetUrl}" class="reset-button">Reset Your Password</a>
                </div>
                
                <div class="warning">
                    <strong>Important:</strong> This password reset link will expire in ${expirationHours} hour${expirationHours > 1 ? 's' : ''}. 
                    If you don't reset your password within this time, you'll need to request a new reset link.
                </div>
                
                <p>If the button above doesn't work, you can also copy and paste the following link into your web browser:</p>
                <p style="word-break: break-all; background-color: #f8f9fa; padding: 10px; border-radius: 3px; font-family: monospace;">
                    ${resetUrl}
                </p>
                
                <p><strong>If you didn't request this password reset:</strong></p>
                <ul>
                    <li>Please ignore this email - your password will remain unchanged</li>
                    <li>Consider changing your password if you're concerned about account security</li>
                    <li>Contact your system administrator if you continue receiving these emails</li>
                </ul>
            </div>
            
            <div class="footer">
                <p>This is an automated message from the Portfolio Management System.</p>
                <div class="security-note">
                    For security reasons, we never ask for your password via email. 
                    Always verify that password reset requests are legitimate.
                </div>
            </div>
        </div>
    </body>
    </html>`;
  }

  generatePasswordResetEmailText(resetUrl, expirationHours = 1) {
    return `
Portfolio Management System - Password Reset Request

Hello,

We received a request to reset the password for your account. If you made this request, please visit the following link to set a new password:

${resetUrl}

IMPORTANT: This password reset link will expire in ${expirationHours} hour${expirationHours > 1 ? 's' : ''}. If you don't reset your password within this time, you'll need to request a new reset link.

If you didn't request this password reset:
- Please ignore this email - your password will remain unchanged
- Consider changing your password if you're concerned about account security
- Contact your system administrator if you continue receiving these emails

This is an automated message from the Portfolio Management System.
For security reasons, we never ask for your password via email.
    `.trim();
  }

  async sendPasswordResetEmail(toEmail, resetUrl, options = {}) {
    if (!this.isConfigured) {
      throw new Error('Email service not configured. Please check SMTP settings.');
    }

    const {
      expirationHours = parseInt(process.env.PASSWORD_RESET_TOKEN_EXPIRE_HOURS) || 1,
      fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER,
      subject = 'Password Reset Request - Portfolio Management System'
    } = options;

    try {
      const htmlContent = this.generatePasswordResetEmailHTML(resetUrl, expirationHours);
      const textContent = this.generatePasswordResetEmailText(resetUrl, expirationHours);

      const mailOptions = {
        from: fromEmail,
        to: toEmail,
        subject: subject,
        text: textContent,
        html: htmlContent,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Password reset email sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      throw new Error('Failed to send password reset email. Please try again later.');
    }
  }

  async sendPasswordChangedNotificationEmail(toEmail, options = {}) {
    if (!this.isConfigured) {
      console.warn('Email service not configured - skipping password change notification');
      return;
    }

    const {
      fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER,
      subject = 'Password Changed - Portfolio Management System'
    } = options;

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Changed</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f4f4f4;
            }
            .container {
                background-color: #ffffff;
                padding: 30px;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .header {
                text-align: center;
                margin-bottom: 30px;
            }
            .logo {
                font-size: 24px;
                font-weight: bold;
                color: #2c3e50;
                margin-bottom: 10px;
            }
            .success {
                background-color: #d4edda;
                border: 1px solid #c3e6cb;
                color: #155724;
                padding: 15px;
                border-radius: 5px;
                margin: 20px 0;
            }
            .footer {
                font-size: 14px;
                color: #666;
                text-align: center;
                margin-top: 30px;
                padding-top: 20px;
                border-top: 1px solid #eee;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">Portfolio Management System</div>
                <h2>Password Successfully Changed</h2>
            </div>
            
            <div class="success">
                <strong>✓ Password Updated</strong><br>
                Your account password has been successfully changed at ${new Date().toLocaleString()}.
            </div>
            
            <p>If you made this change, no further action is required.</p>
            
            <p><strong>If you didn't change your password:</strong></p>
            <ul>
                <li>Contact your system administrator immediately</li>
                <li>Your account may have been compromised</li>
                <li>Consider reviewing your account security settings</li>
            </ul>
            
            <div class="footer">
                <p>This is an automated security notification from the Portfolio Management System.</p>
            </div>
        </div>
    </body>
    </html>`;

    const textContent = `
Portfolio Management System - Password Successfully Changed

Your account password has been successfully changed at ${new Date().toLocaleString()}.

If you made this change, no further action is required.

If you didn't change your password:
- Contact your system administrator immediately
- Your account may have been compromised
- Consider reviewing your account security settings

This is an automated security notification from the Portfolio Management System.
    `.trim();

    try {
      const mailOptions = {
        from: fromEmail,
        to: toEmail,
        subject: subject,
        text: textContent,
        html: htmlContent,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Password change notification sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error('Failed to send password change notification:', error);
      // Don't throw error for notifications - this is non-critical
    }
  }

  async sendLimitBreachEmail(toEmail, details = {}, options = {}) {
    if (!this.isConfigured) {
      console.warn('Email service not configured - skipping limit breach notification');
      return;
    }

    const {
      dealerUsername = '',
      dealNumber = '',
      productType = '',
      amount = '',
      limit = '',
      limitType = 'per-deal'
    } = details;

    const {
      fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER,
      subject = `Dealer Limit Exceeded - ${dealNumber || productType || 'Deal'}`
    } = options;

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dealer Limit Exceeded</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
            .container { background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { text-align: center; margin-bottom: 30px; }
            .logo { font-size: 24px; font-weight: bold; color: #2c3e50; margin-bottom: 10px; }
            .warning { background-color: #fff3cd; border: 1px solid #ffeeba; color: #856404; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .details { margin: 20px 0; }
            .details td { padding: 4px 8px; }
            .footer { font-size: 14px; color: #666; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">Portfolio Management System</div>
                <h2>Dealer Limit Exceeded</h2>
            </div>
            <div class="warning">
                <strong>&#9888; This deal exceeded the entering dealer's ${limitType} limit.</strong><br>
                The deal was still saved and is proceeding through the normal approval workflow.
            </div>
            <table class="details">
                <tr><td><strong>Dealer:</strong></td><td>${dealerUsername}</td></tr>
                <tr><td><strong>Deal Number:</strong></td><td>${dealNumber}</td></tr>
                <tr><td><strong>Product:</strong></td><td>${productType}</td></tr>
                <tr><td><strong>Amount:</strong></td><td>${amount}</td></tr>
                <tr><td><strong>Limit:</strong></td><td>${limit}</td></tr>
            </table>
            <div class="footer">
                <p>This is an automated notification from the Portfolio Management System.</p>
            </div>
        </div>
    </body>
    </html>`;

    const textContent = `
Portfolio Management System - Dealer Limit Exceeded

This deal exceeded the entering dealer's ${limitType} limit. The deal was still saved and is proceeding through the normal approval workflow.

Dealer: ${dealerUsername}
Deal Number: ${dealNumber}
Product: ${productType}
Amount: ${amount}
Limit: ${limit}

This is an automated notification from the Portfolio Management System.
    `.trim();

    try {
      const result = await this.transporter.sendMail({
        from: fromEmail,
        to: toEmail,
        subject,
        text: textContent,
        html: htmlContent,
      });
      console.log('Dealer limit breach email sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error('Failed to send dealer limit breach email:', error);
      // Don't throw - a failed notification must never block the deal save.
    }
  }
}

// Create and export singleton instance
const emailService = new EmailService();

module.exports = emailService;