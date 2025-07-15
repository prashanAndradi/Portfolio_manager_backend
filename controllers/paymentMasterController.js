const db = require('../db');

// Get all distinct bank payment codes from settlement_accounts
exports.getBankPaymentCodes = async (req, res) => {
  try {
    console.log('Fetching bank payment codes');
    const [rows] = await db.query('SELECT DISTINCT bank_payment_code FROM settlement_accounts WHERE bank_payment_code IS NOT NULL AND bank_payment_code != ""');
    console.log('Bank payment codes found:', rows.length);
    res.json({ success: true, data: rows.map(r => r.bank_payment_code) });
  } catch (err) {
    console.error('Error fetching bank payment codes:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Get bank details by bank_payment_code
exports.getBankDetailsByPaymentCode = async (req, res) => {
  try {
    const code = req.params.code;
    console.log('Fetching bank details for code:', code);
    
    const [rows] = await db.query(
      'SELECT bank_name, bank_branch, bank_account_number FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
      [code]
    );
    
    if (rows.length === 0) {
      console.log('No bank details found for code:', code);
      return res.status(404).json({ success: false, error: 'No bank details found for this code' });
    }
    
    console.log('Bank details found:', rows[0]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Error fetching bank details:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Create new Payment Master record
exports.createPaymentMaster = async (req, res) => {
  try {
    console.log('Creating payment master with data:', req.body);
    
    const { PaymentMethod, PaymentMethodOwner, PaymentMethodCode, BankPaymentCode } = req.body;
    
    // Check if required fields are provided
    if (!PaymentMethod || !PaymentMethodOwner || !PaymentMethodCode || !BankPaymentCode) {
      console.log('Missing required fields');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }
    
    // Check if payment method code or payment method already exists
    const [existingRecords] = await db.query(
      'SELECT id FROM payment_masters WHERE payment_method_code = ? OR (payment_method = ? AND payment_method_owner = ?)',
      [PaymentMethodCode, PaymentMethod, PaymentMethodOwner]
    );
    
    if (existingRecords.length > 0) {
      console.log('Payment method or code already exists');
      return res.status(409).json({ 
        success: false, 
        error: 'Payment Method or Code already exists' 
      });
    }
    
    // Insert into database
    const [result] = await db.query(
      'INSERT INTO payment_masters (payment_method, payment_method_owner, payment_method_code, bank_payment_code, created_at) VALUES (?, ?, ?, ?, NOW())',
      [PaymentMethod, PaymentMethodOwner, PaymentMethodCode, BankPaymentCode]
    );
    
    console.log('Payment master created successfully with ID:', result.insertId);
    res.json({ 
      success: true, 
      message: 'Payment master created successfully',
      id: result.insertId
    });
  } catch (err) {
    console.error('Error creating payment master:', err);
    
    // Check for duplicate entry error
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ 
        success: false, 
        error: 'Payment Method or Code already exists' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
};

// Get all Payment Master records
exports.getAllPaymentMasters = async (req, res) => {
  try {
    console.log('Fetching all payment masters');
    const [rows] = await db.query(
      'SELECT id, payment_method, payment_method_owner, payment_method_code, bank_payment_code, created_at FROM payment_masters ORDER BY created_at DESC'
    );
    console.log('Payment masters found:', rows.length);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error fetching payment masters:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Search Payment Master records
exports.searchPaymentMasters = async (req, res) => {
  try {
    const { PaymentMethod } = req.query;
    console.log('Searching payment masters with term:', PaymentMethod);
    
    let query = 'SELECT id, payment_method, payment_method_owner, payment_method_code, bank_payment_code, created_at FROM payment_masters';
    let params = [];
    
    if (PaymentMethod && PaymentMethod.trim()) {
      query += ' WHERE payment_method LIKE ? OR payment_method_owner LIKE ? OR payment_method_code LIKE ?';
      const searchTerm = `%${PaymentMethod.trim()}%`;
      params = [searchTerm, searchTerm, searchTerm];
    }
    
    query += ' ORDER BY created_at DESC';
    
    const [rows] = await db.query(query, params);
    console.log('Search results found:', rows.length);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error searching payment masters:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Update Payment Master record by ID
exports.updatePaymentMaster = async (req, res) => {
  try {
    const id = req.params.id;
    const { PaymentMethod, PaymentMethodOwner, PaymentMethodCode, BankPaymentCode } = req.body;
    
    console.log('Updating payment master ID:', id, 'with data:', req.body);
    
    // Check if required fields are provided
    if (!PaymentMethod || !PaymentMethodOwner || !PaymentMethodCode || !BankPaymentCode) {
      console.log('Missing required fields for update');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }
    
    // Check if the record exists
    const [existingRecord] = await db.query('SELECT id FROM payment_masters WHERE id = ?', [id]);
    if (existingRecord.length === 0) {
      console.log('Payment master not found for ID:', id);
      return res.status(404).json({ 
        success: false, 
        error: 'Payment master not found' 
      });
    }
    
    // Check if payment method code already exists for another record
    const [duplicateCheck] = await db.query(
      'SELECT id FROM payment_masters WHERE payment_method_code = ? AND id != ?',
      [PaymentMethodCode, id]
    );
    
    if (duplicateCheck.length > 0) {
      console.log('Payment method code already exists for another record');
      return res.status(409).json({ 
        success: false, 
        error: 'Payment Method Code already exists' 
      });
    }
    
    // Update the record
    const [result] = await db.query(
      'UPDATE payment_masters SET payment_method = ?, payment_method_owner = ?, payment_method_code = ?, bank_payment_code = ?, updated_at = NOW() WHERE id = ?',
      [PaymentMethod, PaymentMethodOwner, PaymentMethodCode, BankPaymentCode, id]
    );
    
    if (result.affectedRows === 0) {
      console.log('No rows affected during update');
      return res.status(404).json({ 
        success: false, 
        error: 'Payment master not found' 
      });
    }
    
    console.log('Payment master updated successfully');
    res.json({ 
      success: true, 
      message: 'Payment master updated successfully' 
    });
  } catch (err) {
    console.error('Error updating payment master:', err);
    
    // Check for duplicate entry error
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ 
        success: false, 
        error: 'Payment Method Code already exists' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
};

// Get payment methods (predefined list)
exports.getPaymentMethods = async (req, res) => {
  try {
    console.log('Fetching payment methods');
    const paymentMethods = ['RTGS', 'CEFT', 'SLIPS', 'CHEQUE', 'CBSL'];
    res.json({ success: true, data: paymentMethods });
  } catch (err) {
    console.error('Error fetching payment methods:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Delete Payment Master record by ID (optional - if you need delete functionality)
exports.deletePaymentMaster = async (req, res) => {
  try {
    const id = req.params.id;
    console.log('Deleting payment master ID:', id);
    
    // Check if the record exists
    const [existingRecord] = await db.query('SELECT id FROM payment_masters WHERE id = ?', [id]);
    if (existingRecord.length === 0) {
      console.log('Payment master not found for deletion, ID:', id);
      return res.status(404).json({ 
        success: false, 
        error: 'Payment master not found' 
      });
    }
    
    // Delete the record
    const [result] = await db.query('DELETE FROM payment_masters WHERE id = ?', [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Payment master not found' 
      });
    }
    
    console.log('Payment master deleted successfully');
    res.json({ 
      success: true, 
      message: 'Payment master deleted successfully' 
    });
  } catch (err) {
    console.error('Error deleting payment master:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
};