// Script to add authorization columns to the gsec table
const mysql = require('mysql2/promise');

// Define columns to add
const columnsToAdd = [
  { name: 'status', type: 'VARCHAR(20) DEFAULT "pending"', after: 'strategy' },
  { name: 'comment', type: 'TEXT', after: 'status' },
  { name: 'created_by', type: 'INT', after: 'comment' },
  { name: 'created_at', type: 'DATETIME', after: 'created_by' },
  { name: 'updated_by', type: 'INT', after: 'created_at' },
  { name: 'updated_at', type: 'DATETIME', after: 'updated_by' },
  { name: 'authorized_by', type: 'INT', after: 'updated_at' },
  { name: 'authorized_at', type: 'DATETIME', after: 'authorized_by' },
  { name: 'current_approval_level', type: 'VARCHAR(50) DEFAULT "front_office"', after: 'authorized_at' }
];

// Define indexes to create
const indexesToCreate = [
  { name: 'idx_gsec_status', columns: ['status'] },
  { name: 'idx_gsec_created_by', columns: ['created_by'] }
];

// Main function
async function updateGsecTable() {
  let connection;
  
  try {
    // Get database configuration
    let config;
    try {
      config = require('../config/db.js');
    } catch (err) {
      try {
        config = require('../config/database.js');
      } catch (err2) {
        console.error('Could not find database configuration file');
        process.exit(1);
      }
    }
    
    // Create connection
    connection = await mysql.createConnection(config);
    console.log('Connected to database');
    
    // Check if the gsec table exists
    const [tables] = await connection.query('SHOW TABLES LIKE "gsec"');
    if (tables.length === 0) {
      console.error('Error: gsec table does not exist');
      return;
    }
    
    // Get existing columns in the gsec table
    const [columns] = await connection.query('DESCRIBE gsec');
    const existingColumns = columns.map(col => col.Field);
    console.log('Existing columns:', existingColumns.join(', '));
    
    // Add missing columns
    for (const column of columnsToAdd) {
      if (!existingColumns.includes(column.name)) {
        try {
          console.log(`Adding column ${column.name}...`);
          await connection.query(
            `ALTER TABLE gsec ADD COLUMN ${column.name} ${column.type} AFTER ${column.after}`
          );
          console.log(`Column ${column.name} added successfully`);
        } catch (err) {
          console.error(`Error adding column ${column.name}:`, err.message);
        }
      } else {
        console.log(`Column ${column.name} already exists, skipping`);
      }
    }
    
    // Add indexes
    for (const index of indexesToCreate) {
      try {
        console.log(`Creating index ${index.name}...`);
        await connection.query(
          `CREATE INDEX IF NOT EXISTS ${index.name} ON gsec(${index.columns.join(', ')})`
        );
        console.log(`Index ${index.name} created successfully`);
      } catch (err) {
        console.error(`Error creating index ${index.name}:`, err.message);
      }
    }
    
    console.log('GSec table updated successfully');
  } catch (err) {
    console.error('Error updating GSec table:', err);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed');
    }
  }
}

// Run the function
updateGsecTable();
