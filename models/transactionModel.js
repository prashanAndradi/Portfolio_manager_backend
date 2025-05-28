const db = require('../config/db');
const Accounting = require('./accountingModel');
const Counterparty = require('./counterpartyModel');

class Transaction {
  // Get all transactions with joined account information
  static async getAll() {
    try {
      const [rows] = await db.query(`
        SELECT 
          t.*,
          a.name as source_account
        FROM transactions t
        LEFT JOIN accounts a ON t.source_account_id = a.id
        ORDER BY t.date DESC, t.id DESC
      `);
      
      // Attach real counterparty name and type from master
      const enhancedRows = await Promise.all(rows.map(async tx => {
        let counterparty_name = 'N/A';
        let counterparty_type = 'N/A';
        if (tx.counterparty_id) {
          const cp = await Counterparty.getById(tx.counterparty_id);
          if (cp) {
            counterparty_name = cp.name;
            counterparty_type = cp.type;
          }
        }
        return {
          ...tx,
          security_name: tx.security_id ? `Security #${tx.security_id}` : 'N/A',
          counterparty_name,
          counterparty_type,
          transaction_type_name: tx.transaction_type_id ? `Trans Type #${tx.transaction_type_id}` : 'N/A'
        };
      }));
      
      return enhancedRows;
    } catch (error) {
      throw error;
    }
  }

  // Get transactions for a specific account
  static async getByAccountId(accountId) {
    try {
      const [rows] = await db.query(`
        SELECT 
          t.*,
          a.name as source_account
        FROM transactions t
        LEFT JOIN accounts a ON t.source_account_id = a.id
        WHERE t.source_account_id = ?
        ORDER BY t.date DESC, t.id DESC
      `, [accountId]);
      
      // Attach real counterparty name and type from master
      const enhancedRows = await Promise.all(rows.map(async tx => {
        let counterparty_name = 'N/A';
        let counterparty_type = 'N/A';
        if (tx.counterparty_id) {
          const cp = await Counterparty.getById(tx.counterparty_id);
          if (cp) {
            counterparty_name = cp.name;
            counterparty_type = cp.type;
          }
        }
        return {
          ...tx,
          security_name: tx.security_id ? `Security #${tx.security_id}` : 'N/A',
          counterparty_name,
          counterparty_type,
          transaction_type_name: tx.transaction_type_id ? `Trans Type #${tx.transaction_type_id}` : 'N/A'
        };
      }));
      
      return enhancedRows;
    } catch (error) {
      throw error;
    }
  }

  // Get a single transaction by ID
  static async getById(id) {
    try {
      const [rows] = await db.query(`
        SELECT 
          t.*,
          a.name as source_account
        FROM transactions t
        LEFT JOIN accounts a ON t.source_account_id = a.id
        WHERE t.id = ?
      `, [id]);
      
      if (rows.length === 0) {
        return null;
      }
      
      // Attach real counterparty name and type from master
      let counterparty_name = 'N/A';
      let counterparty_type = 'N/A';
      if (rows[0].counterparty_id) {
        const cp = await Counterparty.getById(rows[0].counterparty_id);
        if (cp) {
          counterparty_name = cp.name;
          counterparty_type = cp.type;
        }
      }
      const enhancedTx = {
        ...rows[0],
        security_name: rows[0].security_id ? `Security #${rows[0].security_id}` : 'N/A',
        counterparty_name,
        counterparty_type,
        transaction_type_name: rows[0].transaction_type_id ? `Trans Type #${rows[0].transaction_type_id}` : 'N/A'
      };
      return enhancedTx;
    } catch (error) {
      throw error;
    }
  }

  // Create a new transaction (with account balance update)
  static async create(transaction) {
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // Insert transaction with new fields
      const [result] = await connection.query(
        `INSERT INTO transactions (
          source_account_id, category, amount, date, description, 
          trade_date, value_date, security_id, interest_rate, 
          counterparty_id, transaction_type_id, settlement_mode, price, 
          yield, portfolio, strategy, currency, transaction_code, 
          commission, brokerage, remarks, user, status, comment
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
        [
          transaction.sourceAccount,
          transaction.category,
          transaction.amount,
          transaction.date,
          transaction.description || null,
          transaction.tradeDate,
          transaction.valueDate,
          transaction.security_id,
          transaction.interest_rate,
          transaction.counterparty_id,
          transaction.transaction_type_id,
          transaction.settlement_mode,
          transaction.price,
          transaction.yield,
          transaction.portfolio,
          transaction.strategy,
          transaction.currency,
          transaction.transaction_code,
          transaction.commission,
          transaction.brokerage,
          transaction.remarks,
          transaction.user,
          transaction.status || 'pending',
          transaction.comment || null
        ]
      );
      
      // Update account balance
      await connection.query(
        'UPDATE accounts SET balance = balance + ? WHERE id = ?',
        [transaction.amount, transaction.sourceAccount]
      );
      
      // Add ledger entries for accounting
      const newTransaction = { ...transaction, id: result.insertId };
      try {
        await Accounting.createLedgerEntriesForTransaction(newTransaction, connection);
      } catch (accountingError) {
        console.error('Error creating ledger entries:', accountingError);
        // Continue even if ledger entries fail - don't roll back the transaction
      }
      
      await connection.commit();
      
      // Get the created transaction with joined data
      const createdTransaction = await this.getById(result.insertId);
      return createdTransaction;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // Update a transaction
  static async update(id, transaction) {
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // Get old transaction to calculate balance adjustment
      const [oldTransactionRows] = await connection.query(
        'SELECT amount, source_account_id, status FROM transactions WHERE id = ?',
        [id]
      );
      
      if (oldTransactionRows.length === 0) {
        throw new Error('Transaction not found');
      }
      
      const oldTransaction = oldTransactionRows[0];

      // Check if this is a status update
      if ((transaction.status || transaction.authorization_status) && 
          !transaction.amount && 
          !transaction.sourceAccount && 
          !transaction.category && 
          !transaction.date) {
        
        const status = transaction.status || transaction.authorization_status;
        console.log(`Updating status to ${status} for transaction ${id}`);
        
        // Update the status and comment if provided
        if (transaction.comment) {
          console.log(`Adding comment: ${transaction.comment}`);
          await connection.query(
            'UPDATE transactions SET status = ?, comment = ? WHERE id = ?',
            [status, transaction.comment, id]
          );
        } else {
          await connection.query(
            'UPDATE transactions SET status = ? WHERE id = ?',
            [status, id]
          );
        }
      } else {
        // If amount changed or account changed, adjust balances
        if (oldTransaction.amount !== transaction.amount || 
            oldTransaction.source_account_id !== transaction.sourceAccount) {
          
          // Reverse old transaction from old account
          if (oldTransaction.source_account_id === transaction.sourceAccount) {
            // Same account, just adjust the difference
            await connection.query(
              'UPDATE accounts SET balance = balance - ? + ? WHERE id = ?',
              [oldTransaction.amount, transaction.amount, oldTransaction.source_account_id]
            );
          } else {
            // Different accounts, reverse from old and apply to new
            await connection.query(
              'UPDATE accounts SET balance = balance - ? WHERE id = ?',
              [oldTransaction.amount, oldTransaction.source_account_id]
            );
            
            await connection.query(
              'UPDATE accounts SET balance = balance + ? WHERE id = ?',
              [transaction.amount, transaction.sourceAccount]
            );
          }
          
          // Delete old ledger entries and create new ones
          try {
            await Accounting.deleteLedgerEntriesForTransaction(id, connection);
            
            // Create new ledger entries
            const updatedTransaction = { 
              ...transaction, 
              id: id 
            };
            await Accounting.createLedgerEntriesForTransaction(updatedTransaction, connection);
          } catch (accountingError) {
            console.error('Error updating ledger entries:', accountingError);
            // Continue even if ledger entries fail - don't roll back the transaction
          }
        }
        
        // Build dynamic update query based on provided fields
        const updateFields = [];
        const updateValues = [];
        
        if (transaction.sourceAccount !== undefined) {
          updateFields.push('source_account_id = ?');
          updateValues.push(transaction.sourceAccount);
        }
        
        if (transaction.category !== undefined) {
          updateFields.push('category = ?');
          updateValues.push(transaction.category);
        }
        
        if (transaction.amount !== undefined) {
          updateFields.push('amount = ?');
          updateValues.push(transaction.amount);
        }
        
        if (transaction.date !== undefined) {
          updateFields.push('date = ?');
          updateValues.push(transaction.date);
        }
        
        if (transaction.description !== undefined) {
          updateFields.push('description = ?');
          updateValues.push(transaction.description);
        }
        
        if (transaction.tradeDate !== undefined) {
          updateFields.push('trade_date = ?');
          updateValues.push(transaction.tradeDate);
        }
        
        if (transaction.valueDate !== undefined) {
          updateFields.push('value_date = ?');
          updateValues.push(transaction.valueDate);
        }
        
        if (transaction.security_id !== undefined) {
          updateFields.push('security_id = ?');
          updateValues.push(transaction.security_id);
        }
        
        if (transaction.interest_rate !== undefined) {
          updateFields.push('interest_rate = ?');
          updateValues.push(transaction.interest_rate);
        }
        
        if (transaction.counterparty_id !== undefined) {
          updateFields.push('counterparty_id = ?');
          updateValues.push(transaction.counterparty_id);
        }
        
        if (transaction.transaction_type_id !== undefined) {
          updateFields.push('transaction_type_id = ?');
          updateValues.push(transaction.transaction_type_id);
        }
        
        if (transaction.settlement_mode !== undefined) {
          updateFields.push('settlement_mode = ?');
          updateValues.push(transaction.settlement_mode);
        }
        
        if (transaction.price !== undefined) {
          updateFields.push('price = ?');
          updateValues.push(transaction.price);
        }
        
        if (transaction.yield !== undefined) {
          updateFields.push('yield = ?');
          updateValues.push(transaction.yield);
        }
        
        if (transaction.portfolio !== undefined) {
          updateFields.push('portfolio = ?');
          updateValues.push(transaction.portfolio);
        }
        
        if (transaction.strategy !== undefined) {
          updateFields.push('strategy = ?');
          updateValues.push(transaction.strategy);
        }
        
        if (transaction.currency !== undefined) {
          updateFields.push('currency = ?');
          updateValues.push(transaction.currency);
        }
        
        if (transaction.transaction_code !== undefined) {
          updateFields.push('transaction_code = ?');
          updateValues.push(transaction.transaction_code);
        }
        
        if (transaction.commission !== undefined) {
          updateFields.push('commission = ?');
          updateValues.push(transaction.commission);
        }
        
        if (transaction.brokerage !== undefined) {
          updateFields.push('brokerage = ?');
          updateValues.push(transaction.brokerage);
        }
        
        if (transaction.remarks !== undefined) {
          updateFields.push('remarks = ?');
          updateValues.push(transaction.remarks);
        }
        
        if (transaction.status !== undefined) {
          updateFields.push('status = ?');
          updateValues.push(transaction.status);
        }
        
        if (transaction.comment !== undefined) {
          updateFields.push('comment = ?');
          updateValues.push(transaction.comment);
        }
        
        // Add transaction ID to values array
        updateValues.push(id);
        
        // Execute update if there are fields to update
        if (updateFields.length > 0) {
          await connection.query(
            `UPDATE transactions SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
          );
        }
      }
      
      await connection.commit();
      
      // Get the updated transaction with joined data
      const updatedTransaction = await this.getById(id);
      return updatedTransaction;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // Delete a transaction
  static async delete(id) {
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // Get transaction to adjust account balance
      const [transactionRows] = await connection.query(
        'SELECT amount, source_account_id FROM transactions WHERE id = ?',
        [id]
      );
      
      if (transactionRows.length === 0) {
        throw new Error('Transaction not found');
      }
      
      const transaction = transactionRows[0];
      
      // Delete ledger entries first (foreign key constraint)
      try {
        await Accounting.deleteLedgerEntriesForTransaction(id, connection);
      } catch (accountingError) {
        console.error('Error deleting ledger entries:', accountingError);
        // Continue even if ledger entries deletion fails
      }
      
      // Delete the transaction
      await connection.query('DELETE FROM transactions WHERE id = ?', [id]);
      
      // Reverse the account balance adjustment
      await connection.query(
        'UPDATE accounts SET balance = balance - ? WHERE id = ?',
        [transaction.amount, transaction.source_account_id]
      );
      
      await connection.commit();
      
      return { id, deleted: true };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  
  // Get recent transactions (limit by count)
  static async getRecent(limit = 10) {
    try {
      const [rows] = await db.query(`
        SELECT 
          t.*,
          a.name as source_account
        FROM transactions t
        LEFT JOIN accounts a ON t.source_account_id = a.id
        ORDER BY t.date DESC, t.id DESC
        LIMIT ?
      `, [limit]);
      
      // Attach real counterparty name and type from master
      const enhancedRows = await Promise.all(rows.map(async tx => {
        let counterparty_name = 'N/A';
        let counterparty_type = 'N/A';
        if (tx.counterparty_id) {
          const cp = await Counterparty.getById(tx.counterparty_id);
          if (cp) {
            counterparty_name = cp.name;
            counterparty_type = cp.type;
          }
        }
        return {
          ...tx,
          security_name: tx.security_id ? `Security #${tx.security_id}` : 'N/A',
          counterparty_name,
          counterparty_type,
          transaction_type_name: tx.transaction_type_id ? `Trans Type #${tx.transaction_type_id}` : 'N/A'
        };
      }));
      
      return enhancedRows;
    } catch (error) {
      throw error;
    }
  }
}

// Add these methods outside the class declaration
Transaction.getCounterpartyType = async function(counterpartyId) {
  try {
    // First check if it's an individual counterparty
    let [rows] = await db.query(
      'SELECT id, "individual" as type FROM counterparty_master_individual WHERE id = ?',
      [counterpartyId]
    );
    
    if (rows.length > 0) {
      return rows[0];
    }
    
    // If not found, check if it's a joint counterparty
    [rows] = await db.query(
      'SELECT id, "joint" as type FROM counterparty_master_joint WHERE id = ?',
      [counterpartyId]
    );
    
    if (rows.length > 0) {
      return rows[0];
    }
    
    return null; // Counterparty not found
  } catch (error) {
    throw error;
  }
};

// Get transaction type information by ID
Transaction.getTransactionTypeById = async function(transactionTypeId) {
  try {
    const [rows] = await db.query(
      'SELECT * FROM transaction_types WHERE id = ?',
      [transactionTypeId]
    );
    
    return rows;
  } catch (error) {
    throw error;
  }
};

module.exports = Transaction; 