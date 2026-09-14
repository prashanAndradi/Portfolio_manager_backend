require('./timezone');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

// Create connection pool
// Connect to default database (ITMS-LV1) - all queries use tables from this database
// Queries should NOT use database prefix - tables are in the default database
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'ITMS-LV1', // Default database, but can still query other databases
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Fix date handling to prevent timezone conversion issues
  dateStrings: false,
  timezone: '+00:00'
});

// Test database connection
async function testConnection() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('Database connection established successfully');
    
    // Test database read capability (works without selecting a database)
    console.log('Testing database read capability...');
    const [rows] = await connection.query('SELECT 1 as test');
    console.log('Read test successful:', rows);
    
    // Test querying information_schema to verify connection works
    try {
      const [dbRows] = await connection.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA LIMIT 1');
      console.log('Database server connection verified');
      
      // Test write capability with a simple query
      const [testWrite] = await connection.query('SELECT DATABASE() as current_db');
      console.log('Current database:', testWrite[0]?.current_db || 'none');
    } catch (infoError) {
      console.warn('Information schema query warning:', infoError.message);
    }
    
    connection.release();
  } catch (error) {
    console.error('Database connection or access test failed:', error.message);
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('Access denied. Please check your username and password.');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('Connection refused. Please check if the database server is running.');
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      console.error(`Database "${process.env.DB_NAME || 'ITMS-LV1'}" does not exist. Please check DB_NAME in your .env file.`);
      console.error('You can still use database.table format in queries to access other databases.');
    }
    // Don't exit on error - allow server to start and handle errors gracefully
    console.warn('Continuing despite connection test issues...');
  } finally {
    if (connection) connection.release();
  }
}

// Call the test connection function
testConnection();

module.exports = pool; 