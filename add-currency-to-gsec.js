const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

async function addCurrencyColumn() {
  console.log('Starting to add currency column to gsec table...');
  let connection;

  try {
    // Create connection
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT || 3306,
      database: process.env.DB_NAME,
      multipleStatements: true
    });

    console.log('Connected to MySQL server...');

    // Check if the currency column already exists
    const [columns] = await connection.query('SHOW COLUMNS FROM gsec LIKE "currency"');
    
    if (columns.length > 0) {
      console.log('Currency column already exists in gsec table.');
      return;
    }

    // Add the currency column
    console.log('Adding currency column to gsec table...');
    await connection.query(`
      ALTER TABLE gsec 
      ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'LKR'
    `);
    
    console.log('Successfully added currency column to gsec table!');
  } catch (error) {
    console.error('Error adding currency column:', error);
  } finally {
    if (connection) await connection.end();
  }
}

// Run the function
addCurrencyColumn();
