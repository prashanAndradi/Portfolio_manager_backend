const mysql = require('mysql2/promise');
require('dotenv').config();

// Create a connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'Prashan@321',
  database: process.env.DB_NAME || 'portfolio_manager',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test the connection and create database/tables if needed
const initDatabase = async () => {
  try {
    // Test connection
    const connection = await pool.getConnection();
    console.log('Database connection established successfully');
    
    // Create tables if they don't exist
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('user', 'authorizer', 'admin') NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Users table verified/created');
    
    connection.release();
  } catch (err) {
    console.error('Database initialization error:', err.message);
    console.log('Please make sure:');
    console.log('1. MySQL server is running');
    console.log('2. The credentials in config/database.js are correct');
    console.log('3. The database "portfolio_manager" exists (create it manually if needed)');
  }
};

// Initialize database
initDatabase();

module.exports = {
  query: async (sql, params = []) => {
    const connection = await pool.getConnection();
    const result = await connection.query(sql, params);
    connection.release();
    return result;
  },
  get: async (sql, params = []) => {
    const connection = await pool.getConnection();
    const result = await connection.query(sql, params);
    connection.release();
    return result[0];
  },
  run: async (sql, params = []) => {
    const connection = await pool.getConnection();
    const result = await connection.query(sql, params);
    connection.release();
    return result;
  }
};
