const bcrypt = require('bcrypt');
const db = require('../config/database');

async function createTestUsers() {
  try {
    console.log('Creating test users...');
    
    // Create users table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('user', 'authorizer', 'admin') NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Users table verified/created');
    
    // Check if users already exist
    const [rows] = await db.query('SELECT * FROM users WHERE username IN (?, ?)', ['testuser', 'testauthorizer']);
    
    if (rows.length > 0) {
      console.log('Test users already exist:');
      rows.forEach(user => {
        console.log(`- ${user.username} (${user.role})`);
      });
    } else {
      // Create hashed passwords
      const saltRounds = 10;
      const password = 'test123';
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      
      // Insert test users
      await db.query(`
        INSERT INTO users (username, password, role) VALUES 
        (?, ?, ?),
        (?, ?, ?)
      `, ['testuser', hashedPassword, 'user', 'testauthorizer', hashedPassword, 'authorizer']);
      
      console.log('Test users created successfully:');
      console.log('- Username: testuser, Password: test123, Role: user');
      console.log('- Username: testauthorizer, Password: test123, Role: authorizer');
    }
    
    // List all users
    const [allUsers] = await db.query('SELECT id, username, role, created_at FROM users');
    console.log('\nAll users in database:');
    allUsers.forEach(user => {
      console.log(`- ID: ${user.id}, Username: ${user.username}, Role: ${user.role}, Created: ${user.created_at}`);
    });
    
  } catch (error) {
    console.error('Error creating test users:', error);
  } finally {
    process.exit();
  }
}

createTestUsers();
