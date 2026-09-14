require('./timezone');
const mysql = require('mysql2/promise');
require('dotenv').config();

// Create a connection pool with improved settings
// Connect to default database (ITMS-LV1) - all queries use tables from this database
// Queries should NOT use database prefix - tables are in the default database
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'Prashan@321',
  database: process.env.DB_NAME || 'ITMS-LV1', // Default database, but can still query other databases
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  acquireTimeout: 30000, // 30 seconds
  timeout: 30000, // 30 seconds
  idleTimeout: 300000, // 5 minutes
  reconnect: true,
  // Fix date handling to prevent timezone conversion issues
  dateStrings: false,
  timezone: '+00:00'
});

// Test the connection and create database/tables if needed
const initDatabase = async () => {
  try {
    // Test connection
    const connection = await pool.getConnection();
    console.log('Database connection established successfully');
    
    // IMPORTANT:
    // Do not auto-create tables here. Schema must be managed via migrations (`npm run migrate`),
    // otherwise environments can end up with partial / inconsistent schemas.
    
    connection.release();
  } catch (err) {
    console.error('Database initialization error:', err.message);
    console.log('Please make sure:');
    console.log('1. MySQL server is running');
    console.log('2. The credentials in config/database.js are correct');
    console.log(`3. The database "${process.env.DB_NAME || 'ITMS-LV1'}" exists or set DB_NAME in .env`);
    console.log('4. You can still use database.table format in queries to access other databases');
  }
};

// Initialize database
initDatabase();

// Retry function for database operations
const retryQuery = async (operation, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.log(`Database query attempt ${attempt} failed:`, error.message);
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
};

module.exports = {
  pool,
  query: async (sql, params = []) => {
    return retryQuery(async () => {
      const connection = await pool.getConnection();
      try {
        const result = await connection.query(sql, params);
        return result;
      } finally {
        connection.release();
      }
    });
  },
  get: async (sql, params = []) => {
    return retryQuery(async () => {
      const connection = await pool.getConnection();
      try {
        const result = await connection.query(sql, params);
        return result[0];
      } finally {
        connection.release();
      }
    });
  },
  run: async (sql, params = []) => {
    return retryQuery(async () => {
      const connection = await pool.getConnection();
      try {
        const result = await connection.query(sql, params);
        return result;
      } finally {
        connection.release();
      }
    });
  }
};
