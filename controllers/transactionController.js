const Transaction = require('../models/transactionModel');

// Get all transactions
exports.getAllTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.getAll();
    res.status(200).json({
      success: true,
      data: transactions
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: error.message
    });
  }
};

// Get transactions by account ID
exports.getTransactionsByAccountId = async (req, res) => {
  try {
    const accountId = req.params.accountId;
    const transactions = await Transaction.getByAccountId(accountId);
    
    res.status(200).json({
      success: true,
      data: transactions
    });
  } catch (error) {
    console.error(`Error fetching transactions for account ${req.params.accountId}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: error.message
    });
  }
};

// Get transaction by ID
exports.getTransactionById = async (req, res) => {
  try {
    const id = req.params.id;
    const transaction = await Transaction.getById(id);
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: `Transaction with id ${id} not found`
      });
    }
    
    res.status(200).json({
      success: true,
      data: transaction
    });
  } catch (error) {
    console.error(`Error fetching transaction ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transaction',
      error: error.message
    });
  }
};

// Create transaction
exports.createTransaction = async (req, res) => {
  console.log('Transaction creation request received with body:', req.body);
  try {
    // Map frontend fields to DB columns
    const data = req.body;
    const transactionPayload = {
      sourceAccount: data.sourceAccount,
      category: data.category || data.transactionType, // fallback for old/new frontend
      amount: parseFloat(data.amount),
      date: data.date,
      description: data.description || null,
      tradeDate: data.tradeDate || null,
      valueDate: data.valueDate || null,
      security_id: data.security || null,
      interest_rate: data.interestRate || null,
      counterparty_id: data.counterparty || null,
      transaction_type_id: data.transactionType || null,
      settlement_mode: data.settlementMode || null,
      price: data.price || null,
      yield: data.yield || null,
      portfolio: data.portfolio || null,
      strategy: data.strategy || null,
      currency: data.currency || null,
      transaction_code: data.transactionCode || null,
      commission: data.commission || null,
      brokerage: data.brokerage || null,
      remarks: data.remarks || null,
      user: data.user || null,
      authorization_status: data.authorization_status || 'pending'
    };
    // Create the transaction
    const newTransaction = await Transaction.create(transactionPayload);
    res.status(201).json({ success: true, data: newTransaction });
  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({ success: false, message: 'Failed to create transaction', error: error.message });
  }
};

// Update transaction
exports.updateTransaction = async (req, res) => {
  try {
    const id = req.params.id;
    const data = req.body;
    
    // Get user from request or headers
    const user = req.user || JSON.parse(req.headers['x-user-data'] || '{}');
    
    // Check if transaction exists
    const transaction = await Transaction.getById(id);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: `Transaction with id ${id} not found`
      });
    }
    
    // Check if this is a status update (approval/rejection)
    if (data.status && Object.keys(data).length <= 2) { // status and possibly comment
      // Check if user is authorizer
      if (user?.role !== 'authorizer' && user?.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Only authorizers can update transaction status',
          receivedRole: user?.role
        });
      }
      
      // If status is rejected, require a comment
      if (data.status === 'rejected' && !data.comment) {
        return res.status(400).json({
          success: false,
          message: 'Comment is required when rejecting a transaction'
        });
      }
      
      console.log(`Updating transaction ${id} status to ${data.status}`);
      
      // Update only the status and comment
      const updatedTransaction = await Transaction.update(id, {
        status: data.status,
        comment: data.comment
      });
      
      return res.status(200).json({
        success: true,
        message: `Transaction ${data.status} successfully`,
        data: updatedTransaction
      });
    } else {
      // This is a regular transaction update
      // If rejected, only creator can edit
      if (transaction.status === 'rejected') {
        if (!transaction.user || !user?.username || transaction.user !== user.username) {
          return res.status(403).json({
            success: false,
            message: 'Only the creator can edit a rejected transaction.'
          });
        }
      } else if (user?.role === 'authorizer') {
        return res.status(403).json({
          success: false,
          message: 'Authorizers can only update transaction status'
        });
      }
      // Always reset status to 'pending' for normal users (not authorizer/admin)
      if (user?.role !== 'authorizer' && user?.role !== 'admin') {
        data.status = 'pending';
      }
      // Validate required fields
      if (!data.amount) {
        return res.status(400).json({
          success: false,
          message: 'Amount is required'
        });
      }
      // Update the transaction
      const updatedTransaction = await Transaction.update(id, data);
      
      return res.status(200).json({
        success: true,
        message: 'Transaction updated successfully',
        data: updatedTransaction
      });
    }
  } catch (error) {
    console.error('Error updating transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update transaction',
      error: error.message
    });
  }
};

// Delete transaction
exports.deleteTransaction = async (req, res) => {
  try {
    const id = req.params.id;
    
    // Check if transaction exists
    const transaction = await Transaction.getById(id);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: `Transaction with id ${id} not found`
      });
    }
    
    await Transaction.delete(id);
    
    res.status(200).json({
      success: true,
      message: 'Transaction deleted successfully'
    });
  } catch (error) {
    console.error(`Error deleting transaction ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete transaction',
      error: error.message
    });
  }
};

// Get recent transactions
exports.getRecentTransactions = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const transactions = await Transaction.getRecent(limit);
    
    res.status(200).json({
      success: true,
      data: transactions
    });
  } catch (error) {
    console.error('Error fetching recent transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recent transactions',
      error: error.message
    });
  }
};

// Test database write operation
exports.testDatabaseWrite = async (req, res) => {
  const db = require('../config/db');
  
  try {
    console.log('Testing direct database write...');
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();
      
      console.log('Executing test insertion...');
      const [result] = await connection.query(
        'INSERT INTO transactions (source_account_id, category, amount, date, description) VALUES (?, ?, ?, ?, ?)',
        [1, 'Income', 100.00, new Date().toISOString().split('T')[0], 'Test transaction from API']
      );
      
      console.log('Test insertion successful, ID:', result.insertId);
      
      // Update account balance
      const [updateResult] = await connection.query(
        'UPDATE accounts SET balance = balance + ? WHERE id = ?',
        [100.00, 1]
      );
      
      console.log('Test account update complete, affected rows:', updateResult.affectedRows);
      
      await connection.commit();
      console.log('Test transaction committed');
      
      res.status(200).json({
        success: true,
        message: 'Test database write successful',
        insertId: result.insertId,
        updateRows: updateResult.affectedRows
      });
    } catch (error) {
      console.error('Error in test database write - ROLLING BACK:', error);
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error in testDatabaseWrite:', error);
    res.status(500).json({
      success: false,
      message: 'Test database write failed',
      error: error.message
    });
  }
}; 