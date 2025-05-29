const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');

// Get database configuration
let config;
try {
  config = require('../config/db.js');
} catch (err) {
  try {
    config = require('../config/database.js');
  } catch (err2) {
    console.error('Could not find database configuration file:', err2);
    process.exit(1);
  }
}

// Create database connection
const db = mysql.createConnection(config);

// Read SQL file
const sqlFilePath = path.join(__dirname, 'add_auth_columns.sql');
console.log('Reading SQL from:', sqlFilePath);
const sql = fs.readFileSync(sqlFilePath, 'utf8');

// Split into statements and execute
const statements = sql.split(';').filter(s => s.trim());
let completedStatements = 0;

statements.forEach((statement, index) => {
  if(statement.trim()) {
    console.log(`Executing statement ${index + 1}/${statements.length}:`, statement.trim());
    
    db.query(statement.trim(), (err, result) => {
      completedStatements++;
      
      if(err) {
        console.error('Error executing SQL:', err);
      } else {
        console.log('Success:', result);
      }
      
      // If all statements have been processed, close the connection
      if (completedStatements === statements.length) {
        console.log('All SQL statements executed. Closing connection.');
        db.end();
      }
    });
  }
});

// Safety timeout to ensure the script exits even if there's an issue with the query callbacks
setTimeout(() => {
  console.log('Timeout reached. Closing connection if still open.');
  try {
    db.end();
  } catch (e) {
    // Connection might already be closed
  }
  process.exit(0);
}, 5000);
