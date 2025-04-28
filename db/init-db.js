const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

async function initializeDatabase() {
  console.log('Starting database initialization...');
  let connection;

  try {
    // Create connection
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT || 3306,
      multipleStatements: true  // Important for running multiple SQL statements
    });

    console.log('Connected to MySQL server...');

    // Check if database exists, create if it doesn't
    console.log(`Checking if database '${process.env.DB_NAME}' exists...`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME};`);
    console.log(`Database '${process.env.DB_NAME}' ensured.`);

    // Use the database
    await connection.query(`USE ${process.env.DB_NAME};`);
    console.log(`Now using database '${process.env.DB_NAME}'.`);

    // Read SQL file
    const sqlFilePath = path.join(__dirname, 'init.sql');
    const sqlScript = fs.readFileSync(sqlFilePath, 'utf8');
    console.log('SQL script loaded from file.');

    // Execute SQL script
    console.log('Executing SQL script...');
    await connection.query(sqlScript);
    console.log('SQL script executed successfully.');

    console.log('Database initialization complete!');
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

// Run the initialization
initializeDatabase(); 