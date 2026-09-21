const db = require('../config/db');
const fs = require('fs').promises;
const path = require('path');

class TransactionDocument {
  /**
   * Create a new document record
   * @param {Object} documentData - Document metadata
   * @returns {Promise<Object>} Created document record
   */
  static async create(documentData) {
    try {
      const {
        transaction_type,
        transaction_id,
        file_name,
        file_path,
        file_size,
        mime_type,
        uploaded_by,
        description
      } = documentData;

      const [result] = await db.query(`
        INSERT INTO transaction_documents (
          transaction_type,
          transaction_id,
          file_name,
          file_path,
          file_size,
          mime_type,
          uploaded_by,
          description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        transaction_type,
        transaction_id,
        file_name,
        file_path,
        file_size,
        mime_type,
        uploaded_by || null,
        description || null
      ]);

      return await this.getById(result.insertId);
    } catch (error) {
      console.error('Error creating document record:', error);
      throw error;
    }
  }

  /**
   * Get all documents for a specific transaction
   * @param {String} transactionType - Type of transaction (e.g., 'gsec', 'money_market')
   * @param {String} transactionId - Transaction ID or deal number
   * @returns {Promise<Array>} Array of document records
   */
  static async getByTransaction(transactionType, transactionId) {
    try {
      // Try with users table first, fallback to without if it doesn't exist
      let rows;
      try {
        [rows] = await db.query(`
          SELECT 
            td.*,
            u.username as uploaded_by_username
          FROM transaction_documents td
          LEFT JOIN users u ON td.uploaded_by = u.id
          WHERE td.transaction_type = ? AND td.transaction_id = ?
          ORDER BY td.created_at DESC
        `, [transactionType, transactionId]);
      } catch (joinError) {
        // If users table doesn't exist or JOIN fails, query without it
        console.warn('Users table JOIN failed, querying without username:', joinError.message);
        [rows] = await db.query(`
          SELECT 
            td.*,
            NULL as uploaded_by_username
          FROM transaction_documents td
          WHERE td.transaction_type = ? AND td.transaction_id = ?
          ORDER BY td.created_at DESC
        `, [transactionType, transactionId]);
      }

      return rows;
    } catch (error) {
      console.error('Error fetching documents by transaction:', error);
      throw error;
    }
  }

  /**
   * Get a single document by ID
   * @param {Number} id - Document ID
   * @returns {Promise<Object|null>} Document record or null
   */
  static async getById(id) {
    try {
      // Try with users table first, fallback to without if it doesn't exist
      let rows;
      try {
        [rows] = await db.query(`
          SELECT 
            td.*,
            u.username as uploaded_by_username
          FROM transaction_documents td
          LEFT JOIN users u ON td.uploaded_by = u.id
          WHERE td.id = ?
        `, [id]);
      } catch (joinError) {
        // If users table doesn't exist or JOIN fails, query without it
        console.warn('Users table JOIN failed, querying without username:', joinError.message);
        [rows] = await db.query(`
          SELECT 
            td.*,
            NULL as uploaded_by_username
          FROM transaction_documents td
          WHERE td.id = ?
        `, [id]);
      }

      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error fetching document by ID:', error);
      throw error;
    }
  }

  /**
   * Delete a document record and its file
   * @param {Number} id - Document ID
   * @returns {Promise<Boolean>} Success status
   */
  static async delete(id) {
    try {
      // Get document info before deleting
      const document = await this.getById(id);
      if (!document) {
        throw new Error('Document not found');
      }

      // Delete file from filesystem
      try {
        const filePath = path.join(__dirname, '..', document.file_path);
        await fs.unlink(filePath);
        console.log(`Deleted file: ${filePath}`);
      } catch (fileError) {
        // Log but don't fail if file doesn't exist
        console.warn(`File not found or already deleted: ${document.file_path}`, fileError.message);
      }

      // Delete database record
      const [result] = await db.query(`
        DELETE FROM transaction_documents WHERE id = ?
      `, [id]);

      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting document:', error);
      throw error;
    }
  }

  /**
   * Update document metadata
   * @param {Number} id - Document ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated document record
   */
  static async update(id, updates) {
    try {
      const allowedFields = ['description', 'file_name'];
      const updateFields = [];
      const updateValues = [];

      Object.keys(updates).forEach(key => {
        if (allowedFields.includes(key)) {
          updateFields.push(`${key} = ?`);
          updateValues.push(updates[key]);
        }
      });

      if (updateFields.length === 0) {
        throw new Error('No valid fields to update');
      }

      updateValues.push(id);

      const [result] = await db.query(`
        UPDATE transaction_documents
        SET ${updateFields.join(', ')}
        WHERE id = ?
      `, updateValues);

      if (result.affectedRows === 0) {
        throw new Error('Document not found');
      }

      return await this.getById(id);
    } catch (error) {
      console.error('Error updating document:', error);
      throw error;
    }
  }

  /**
   * Get file path for download
   * @param {Number} id - Document ID
   * @returns {Promise<String>} Absolute file path
   */
  static async getFilePath(id) {
    try {
      const document = await this.getById(id);
      if (!document) {
        throw new Error('Document not found');
      }

      return path.join(__dirname, '..', document.file_path);
    } catch (error) {
      console.error('Error getting file path:', error);
      throw error;
    }
  }
}

module.exports = TransactionDocument;
