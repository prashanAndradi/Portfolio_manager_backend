const mysql = require('mysql2/promise');

// First create a connection without specifying a database
const setupDatabase = async () => {
  // Connection without database selection
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'password' // Use your actual password
  });

  try {
    // Create database if it doesn't exist
    await connection.query(`CREATE DATABASE IF NOT EXISTS portfolio_db`);
    console.log('Database portfolio_db created or already exists');

    // Use the database
    await connection.query(`USE portfolio_db`);
    
    // Create users table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('user', 'authorizer', 'admin') NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Users table created successfully');

    // Create some test users if the table is empty
    const [rows] = await connection.query('SELECT COUNT(*) as count FROM users');
    if (rows[0].count === 0) {
      // Add a test authorizer user
      const bcrypt = require('bcrypt');
      const hashedPassword = await bcrypt.hash('test123', 10);
      
      await connection.query(`
        INSERT INTO users (username, password, role) VALUES 
        ('testuser', ?, 'user'),
        ('testauthorizer', ?, 'authorizer')
      `, [hashedPassword, hashedPassword]);
      
      console.log('Test users created successfully');
    } else {
      console.log(`Users table already has ${rows[0].count} records`);
    }

  } catch (error) {
    console.error('Setup error:', error);
  } finally {
    await connection.end();
    console.log('Database setup complete');
  }
};

setupDatabase().catch(console.error);
