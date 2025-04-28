const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

// Create connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test database connection
async function testConnection() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('Database connection established successfully');
    
    // Test database read capability
    console.log('Testing database read capability...');
    const [rows] = await connection.query('SELECT 1 as test');
    console.log('Read test successful:', rows);
    
    // Test database write capability with a temporary table
    console.log('Testing database write capability...');
    try {
      await connection.query('CREATE TEMPORARY TABLE write_test (id INT, value VARCHAR(50))');
      await connection.query('INSERT INTO write_test VALUES (1, "test")');
      const [testRows] = await connection.query('SELECT * FROM write_test');
      console.log('Write test successful:', testRows);
    } catch (writeError) {
      console.error('Database write test failed:', writeError.message);
      throw writeError;
    }
    
    connection.release();
  } catch (error) {
    console.error('Database connection or access test failed:', error.message);
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('Access denied. Please check your username and password.');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('Connection refused. Please check if the database server is running.');
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      console.error('Database does not exist. Please create it or check the DB_NAME in your .env file.');
    }
    process.exit(1);
  } finally {
    if (connection) connection.release();
  }
}

// Call the test connection function
testConnection();

module.exports = pool; 