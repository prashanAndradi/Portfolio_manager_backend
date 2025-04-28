const db = require('../config/db');

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
      
      // Manually add placeholder data for missing tables
      const enhancedRows = rows.map(tx => ({
        ...tx,
        security_name: tx.security_id ? `Security #${tx.security_id}` : 'N/A',
        counterparty_name: tx.counterparty_id ? `Counterparty #${tx.counterparty_id}` : 'N/A',
        transaction_type_name: tx.transaction_type_id ? `Trans Type #${tx.transaction_type_id}` : 'N/A'
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
      
      // Manually add placeholder data for missing tables
      const enhancedRows = rows.map(tx => ({
        ...tx,
        security_name: tx.security_id ? `Security #${tx.security_id}` : 'N/A',
        counterparty_name: tx.counterparty_id ? `Counterparty #${tx.counterparty_id}` : 'N/A',
        transaction_type_name: tx.transaction_type_id ? `Trans Type #${tx.transaction_type_id}` : 'N/A'
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
      
      // Manually add placeholder data for missing tables
      const enhancedTx = {
        ...rows[0],
        security_name: rows[0].security_id ? `Security #${rows[0].security_id}` : 'N/A',
        counterparty_name: rows[0].counterparty_id ? `Counterparty #${rows[0].counterparty_id}` : 'N/A',
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
              [oldTransaction.amount, transaction.amount, transaction.sourceAccount]
            );
          } else {
            // Different accounts, reverse from old and add to new
            await connection.query(
              'UPDATE accounts SET balance = balance - ? WHERE id = ?',
              [oldTransaction.amount, oldTransaction.source_account_id]
            );
            
            await connection.query(
              'UPDATE accounts SET balance = balance + ? WHERE id = ?',
              [transaction.amount, transaction.sourceAccount]
            );
          }
        }
        
        // Update transaction data
        await connection.query(
          'UPDATE transactions SET source_account_id = ?, category = ?, amount = ?, date = ?, description = ?, status = ? WHERE id = ?',
          [
            transaction.sourceAccount,
            transaction.category,
            transaction.amount,
            transaction.date,
            transaction.description || null,
            transaction.status || oldTransaction.status,
            id
          ]
        );
      }
      
      await connection.commit();
      
      // Get the updated transaction
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
      
      // Get transaction details before deletion
      const [transactionRows] = await connection.query(
        'SELECT amount, source_account_id FROM transactions WHERE id = ?',
        [id]
      );
      
      if (transactionRows.length === 0) {
        throw new Error('Transaction not found');
      }
      
      const transaction = transactionRows[0];
      
      // Reverse the transaction amount from the account balance
      await connection.query(
        'UPDATE accounts SET balance = balance - ? WHERE id = ?',
        [transaction.amount, transaction.source_account_id]
      );
      
      // Delete the transaction
      await connection.query('DELETE FROM transactions WHERE id = ?', [id]);
      
      await connection.commit();
      return id;
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
      
      // Manually add placeholder data for missing tables
      const enhancedRows = rows.map(tx => ({
        ...tx,
        security_name: tx.security_id ? `Security #${tx.security_id}` : 'N/A',
        counterparty_name: tx.counterparty_id ? `Counterparty #${tx.counterparty_id}` : 'N/A',
        transaction_type_name: tx.transaction_type_id ? `Trans Type #${tx.transaction_type_id}` : 'N/A'
      }));
      
      return enhancedRows;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = Transaction; 