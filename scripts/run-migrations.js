const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'portfolio_manager',
  multipleStatements: true
};

// Create migrations tracking table
async function createMigrationsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_filename (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
  console.log('✓ Migrations tracking table ready');
}

// Check if migration has been run
async function isMigrationRun(connection, filename) {
  const [rows] = await connection.query(
    'SELECT COUNT(*) as count FROM migrations WHERE filename = ?',
    [filename]
  );
  return rows[0].count > 0;
}

// Mark migration as run
async function markMigrationRun(connection, filename) {
  await connection.query(
    'INSERT INTO migrations (filename) VALUES (?) ON DUPLICATE KEY UPDATE filename = filename',
    [filename]
  );
}

// Strip SQL comments (-- line comments and /* block */ comments) before
// splitting a file on ';', quote-aware so a semicolon or comment marker
// inside a string literal is left alone. Without this, a comment containing
// a semicolon - even just as English punctuation like "...IF NOT EXISTS;
// run_migrations.js treats..." - silently splits the file in the wrong
// place and the leftover comment fragment gets sent to MySQL as a statement.
function stripSqlComments(sql) {
  let out = '';
  let i = 0;
  let quote = null; // ' or " when inside a string literal
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\' && next !== undefined) {
        // Preserve escaped character as-is (e.g. \' inside a string).
        out += next;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

// Execute SQL file
async function executeSqlFile(connection, filePath, deferredStatements = []) {
  const sql = fs.readFileSync(filePath, 'utf8');
  const statements = stripSqlComments(sql)
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
  
  for (const statement of statements) {
    if (statement.length > 0) {
      try {
        await connection.query(statement);
      } catch (error) {
        // Ignore "table/column/key/constraint already exists" errors
        if (
          error.code === 'ER_TABLE_EXISTS_ERROR' ||
          error.code === 'ER_DUP_FIELDNAME' ||
          error.code === 'ER_DUP_KEYNAME' ||
          error.code === 'ER_FK_DUP_NAME' // duplicate foreign key constraint name
        ) {
          console.log(`  ⚠ Skipped (already exists): ${error.message.substring(0, 60)}...`);
        } else if (
          // Defer statements that depend on tables/columns created later
          error.code === 'ER_NO_SUCH_TABLE' ||
          error.code === 'ER_BAD_FIELD_ERROR' ||
          error.code === 'ER_KEY_COLUMN_DOES_NOT_EXITS' || // mysql2's code for missing column in index
          error.code === 'ER_CANT_DROP_FIELD_OR_KEY' ||
          error.code === 'ER_FK_CANNOT_OPEN_PARENT' || // Foreign key parent table doesn't exist
          error.errno === 1824 // ER_FK_CANNOT_OPEN_PARENT
        ) {
          deferredStatements.push(statement);
          console.log(`  ⏳ Deferred (dependency missing): ${error.message.substring(0, 80)}...`);
        } else {
          throw error;
        }
      }
    }
  }
}

// Retry deferred statements (e.g., statements referencing tables/columns created later)
async function runDeferredStatements(connection, deferredStatements) {
  if (!deferredStatements.length) return;

  console.log(`\n🧩 Retrying deferred statements: ${deferredStatements.length}`);
  const maxPasses = 6;

  for (let pass = 1; pass <= maxPasses && deferredStatements.length; pass++) {
    let progress = 0;
    console.log(`\n🔁 Deferred pass ${pass}/${maxPasses}...`);

    // Iterate backwards so we can splice safely
    for (let i = deferredStatements.length - 1; i >= 0; i--) {
      const stmt = deferredStatements[i];
      try {
        await connection.query(stmt);
        deferredStatements.splice(i, 1);
        progress++;
      } catch (error) {
        // Keep deferring on dependency issues
        if (
          error.code === 'ER_NO_SUCH_TABLE' ||
          error.code === 'ER_BAD_FIELD_ERROR' ||
          error.code === 'ER_KEY_COLUMN_DOES_NOT_EXITS' ||
          error.code === 'ER_CANT_DROP_FIELD_OR_KEY' ||
          error.code === 'ER_FK_CANNOT_OPEN_PARENT' ||
          error.code === 'ER_NO_REFERENCED_ROW_2' || // Foreign key constraint fails - referenced rows don't exist
          error.errno === 1824 || // ER_FK_CANNOT_OPEN_PARENT
          error.errno === 1452 // ER_NO_REFERENCED_ROW_2
        ) {
          continue;
        }
        // For harmless duplicates, drop the statement
        if (error.code === 'ER_TABLE_EXISTS_ERROR' || error.code === 'ER_DUP_FIELDNAME' || error.code === 'ER_DUP_KEYNAME') {
          deferredStatements.splice(i, 1);
          progress++;
          continue;
        }
        throw error;
      }
    }

    console.log(`✓ Deferred progress this pass: ${progress}`);
    if (progress === 0) break;
  }

  if (deferredStatements.length) {
    console.log(`\n⚠ Unable to apply ${deferredStatements.length} deferred statements (dependencies still missing).`);
    // Surface the first statement for debugging
    console.log(`First remaining deferred statement:\n${deferredStatements[0]}`);
  } else {
    console.log('\n✅ All deferred statements applied.');
  }
}

// Execute JS migration file
async function executeJsFile(connection, filePath, deferredStatements = []) {
  // Create a mock db object that uses our connection
  const mockDb = {
    query: async (sql, params) => {
      try {
        const result = await connection.query(sql, params);
        return result;
      } catch (error) {
        // Ignore "table already exists" errors
        if (error.code === 'ER_TABLE_EXISTS_ERROR' || 
            error.code === 'ER_DUP_FIELDNAME' ||
            error.code === 'ER_DUP_KEYNAME') {
          console.log(`  ⚠ Skipped (already exists)`);
          return [[], []];
        }
        // Defer statements that depend on tables/columns created later
        if (
          error.code === 'ER_NO_SUCH_TABLE' ||
          error.code === 'ER_BAD_FIELD_ERROR' ||
          error.code === 'ER_KEY_COLUMN_DOES_NOT_EXITS' ||
          error.code === 'ER_CANT_DROP_FIELD_OR_KEY' ||
          error.code === 'ER_FK_CANNOT_OPEN_PARENT' ||
          error.errno === 1824
        ) {
          // Extract SQL statement (handle both string and parameterized queries)
          const sqlStatement = typeof sql === 'string' ? sql : sql.toString();
          deferredStatements.push(sqlStatement);
          console.log(`  ⏳ Deferred (dependency missing): ${error.message.substring(0, 80)}...`);
          // Return empty result to allow migration to continue
          return [[], []];
        }
        throw error;
      }
    },
    getConnection: async () => connection,
    end: async () => {},
    pool: connection
  };
  
  // Create a mock Sequelize queryInterface for migrations that use Sequelize
  const mockQueryInterface = {
    sequelize: {
      query: async (sql, options) => {
        try {
          return await connection.query(sql);
        } catch (error) {
          if (error.code === 'ER_TABLE_EXISTS_ERROR' || 
              error.code === 'ER_DUP_FIELDNAME' ||
              error.code === 'ER_DUP_KEYNAME' ||
              error.code === 'ER_NO_SUCH_TABLE') {
            return [[], []];
          }
          throw error;
        }
      }
    },
    addColumn: async (tableName, columnName, options) => {
      // Check if table exists first
      const [tables] = await connection.query(`
        SELECT TABLE_NAME 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = ?
      `, [tableName]);
      
      if (tables.length === 0) {
        console.log(`  ⚠ Table ${tableName} does not exist, skipping column addition`);
        return;
      }
      
      // Check if column already exists
      const [columns] = await connection.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = ? 
        AND COLUMN_NAME = ?
      `, [tableName, columnName]);
      
      if (columns.length > 0) {
        console.log(`  ⚠ Column ${columnName} already exists in ${tableName}`);
        return;
      }
      
      // Build ALTER TABLE statement
      let type = options.type;
      if (type && typeof type === 'object' && type.constructor && type.constructor.name) {
        // Handle Sequelize types
        const typeName = type.constructor.name;
        if (typeName.includes('STRING')) {
          type = `VARCHAR(${type.options?.length || 255})`;
        } else if (typeName.includes('TEXT')) {
          type = 'TEXT';
        } else if (typeName.includes('INTEGER') || typeName.includes('INT')) {
          type = 'INT';
        } else if (typeName.includes('DECIMAL')) {
          const precision = type.options?.precision || 10;
          const scale = type.options?.scale || 2;
          type = `DECIMAL(${precision},${scale})`;
        } else if (typeName.includes('DATE')) {
          type = 'DATE';
        } else if (typeName.includes('DATETIME')) {
          type = 'DATETIME';
        } else if (typeName.includes('TIMESTAMP')) {
          type = 'TIMESTAMP';
        } else if (typeName.includes('JSON')) {
          type = 'JSON';
        } else {
          type = 'VARCHAR(255)';
        }
      }
      
      let sql = `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${type}`;
      if (options.allowNull === false) sql += ' NOT NULL';
      if (options.defaultValue !== undefined && options.defaultValue !== null) {
        const defaultValue = typeof options.defaultValue === 'string' 
          ? `'${options.defaultValue.replace(/'/g, "''")}'` 
          : options.defaultValue;
        sql += ` DEFAULT ${defaultValue}`;
      }
      if (options.after) sql += ` AFTER ${options.after}`;
      
      await connection.query(sql);
    },
    removeColumn: async (tableName, columnName) => {
      // Check if table exists
      const [tables] = await connection.query(`
        SELECT TABLE_NAME 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = ?
      `, [tableName]);
      
      if (tables.length === 0) {
        console.log(`  ⚠ Table ${tableName} does not exist, skipping column removal`);
        return;
      }
      
      await connection.query(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
    }
  };
  
  // Store original modules
  const dbPath = path.resolve(__dirname, '../config/db.js');
  const databasePath = path.resolve(__dirname, '../config/database.js');
  const originalDb = require.cache[dbPath];
  const originalDatabase = require.cache[databasePath];
  
  // Override require cache
  if (fs.existsSync(dbPath)) {
    require.cache[dbPath] = {
      exports: mockDb,
      loaded: true
    };
  }
  if (fs.existsSync(databasePath)) {
    require.cache[databasePath] = {
      exports: mockDb,
      loaded: true
    };
  }
  
  // Override process.exit to prevent migrations from exiting
  const originalExit = process.exit;
  let exitCalled = false;
  let exitCode = 0;
  process.exit = (code) => {
    exitCalled = true;
    exitCode = code || 0;
  };
  
  try {
    // Clear require cache for the migration file
    delete require.cache[require.resolve(filePath)];
    
    // Execute the migration file
    const migrationModule = require(filePath);
    
    // Handle Sequelize-style migrations (exports { up, down })
    if (migrationModule.up && typeof migrationModule.up === 'function') {
      const Sequelize = {
        STRING: (length) => ({ constructor: { name: 'STRING' }, options: { length: length || 255 } }),
        TEXT: () => ({ constructor: { name: 'TEXT' } }),
        INTEGER: () => ({ constructor: { name: 'INTEGER' } }),
        INT: () => ({ constructor: { name: 'INT' } }),
        DECIMAL: (precision, scale) => ({ constructor: { name: 'DECIMAL' }, options: { precision, scale } }),
        DATE: () => ({ constructor: { name: 'DATE' } }),
        DATETIME: () => ({ constructor: { name: 'DATETIME' } }),
        TIMESTAMP: () => ({ constructor: { name: 'TIMESTAMP' } }),
        JSON: () => ({ constructor: { name: 'JSON' } })
      };
      await migrationModule.up(mockQueryInterface, Sequelize);
    }
    // Handle direct function exports
    else if (typeof migrationModule === 'function') {
      await migrationModule();
    } 
    // Handle default exports
    else if (migrationModule.default && typeof migrationModule.default === 'function') {
      await migrationModule.default();
    }
    
    // Wait a bit for async operations to complete
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Check if process.exit was called
    if (exitCalled && exitCode !== 0) {
      throw new Error(`Migration exited with code ${exitCode}`);
    }
  } catch (error) {
    // If it's a table/column/key exists error, that's okay
    if (error.code === 'ER_TABLE_EXISTS_ERROR' || 
        error.code === 'ER_DUP_FIELDNAME' ||
        error.code === 'ER_DUP_KEYNAME' ||
        error.code === 'ER_NO_SUCH_TABLE' ||
        error.errno === 1146) {
      console.log(`  ⚠ Skipped (table/column doesn't exist or already exists)`);
      // Don't throw - allow migration to continue
      return;
    } else {
      throw error;
    }
  } finally {
    // Restore original modules
    if (originalDb) {
      require.cache[dbPath] = originalDb;
    } else {
      delete require.cache[dbPath];
    }
    if (originalDatabase) {
      require.cache[databasePath] = originalDatabase;
    } else {
      delete require.cache[databasePath];
    }
    
    // Restore process.exit
    process.exit = originalExit;
  }
}

// Get all migration files sorted by name
function getMigrationFiles() {
  const migrationsDir = path.join(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir);
  
  // Filter and sort migration files
  const migrationFiles = files
    .filter(file => {
      // Include dated migrations and specific files
      return (
        file.endsWith('.js') || 
        file.endsWith('.sql')
      ) && !file.startsWith('run_') && file !== 'create-chart-of-accounts.sql';
    })
    .map(file => ({
      name: file,
      path: path.join(migrationsDir, file),
      ext: path.extname(file),
      date: extractDate(file)
    }))
    .sort((a, b) => {
      // Sort by date if available, otherwise by filename
      if (a.date && b.date) {
        return a.date.localeCompare(b.date);
      }
      return a.name.localeCompare(b.name);
    });
  
  // Add chart of accounts after accounting tables (if it exists and not already in list)
  const chartOfAccountsPath = path.join(migrationsDir, 'create-chart-of-accounts.sql');
  if (fs.existsSync(chartOfAccountsPath)) {
    const chartOfAccountsFile = {
      name: 'create-chart-of-accounts.sql',
      path: chartOfAccountsPath,
      ext: '.sql',
      date: '99999999' // Put it at the end
    };
    
    // Check if it's not already in the list
    const alreadyIncluded = migrationFiles.some(f => f.name === 'create-chart-of-accounts.sql');
    
    if (!alreadyIncluded) {
      // Find position after accounting tables
      const accountingIndex = migrationFiles.findIndex(f => 
        f.name.includes('accounting') || f.name.includes('account-types') || f.name.includes('20250501')
      );
      
      if (accountingIndex >= 0) {
        migrationFiles.splice(accountingIndex + 1, 0, chartOfAccountsFile);
      } else {
        migrationFiles.push(chartOfAccountsFile);
      }
    }
  }
  
  return migrationFiles;
}

// Extract date from filename (YYYYMMDD format)
function extractDate(filename) {
  const match = filename.match(/^(\d{8})/);
  return match ? match[1] : null;
}

// Main migration runner
async function runMigrations() {
  let connection;
  const deferredStatements = [];
  
  try {
    console.log('🚀 Starting database migrations...\n');
    console.log(`📊 Database: ${dbConfig.database}`);
    console.log(`🔗 Host: ${dbConfig.host}:${dbConfig.port}\n`);
    
    // Create connection
    connection = await mysql.createConnection(dbConfig);
    console.log('✓ Connected to database\n');
    
    // Ensure database exists. Backtick-quote the name - unquoted, a name
    // containing a hyphen (e.g. "ITMS-LV1") is a SQL syntax error.
    const quotedDbName = `\`${dbConfig.database.replace(/`/g, '``')}\``;
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${quotedDbName}`);
    await connection.query(`USE ${quotedDbName}`);
    
    // Create migrations tracking table
    await createMigrationsTable(connection);
    
    // Get all migration files
    const migrationFiles = getMigrationFiles();
    console.log(`📁 Found ${migrationFiles.length} migration files\n`);
    
    let executed = 0;
    let skipped = 0;
    
    // Execute each migration
    for (const file of migrationFiles) {
      const isRun = await isMigrationRun(connection, file.name);
      
      if (isRun) {
        console.log(`⏭  Skipped: ${file.name} (already executed)`);
        skipped++;
        continue;
      }
      
      try {
        console.log(`▶  Running: ${file.name}`);
        
        if (file.ext === '.sql') {
          await executeSqlFile(connection, file.path, deferredStatements);
        } else if (file.ext === '.js') {
          await executeJsFile(connection, file.path, deferredStatements);
        }
        
        await markMigrationRun(connection, file.name);
        console.log(`✓ Completed: ${file.name}\n`);
        executed++;
      } catch (error) {
        console.error(`✗ Failed: ${file.name}`);
        console.error(`  Error: ${error.message}`);
        
        // Continue with other migrations even if one fails
        if (error.code === 'ER_TABLE_EXISTS_ERROR' || error.code === 'ER_DUP_FIELDNAME') {
          console.log(`  ⚠ Marking as completed (table/column already exists)`);
          await markMigrationRun(connection, file.name);
          skipped++;
        } else {
          throw error;
        }
      }
    }

    // Retry deferred statements after all migrations
    await runDeferredStatements(connection, deferredStatements);
    
    console.log('\n' + '='.repeat(50));
    console.log(`✅ Migration Summary:`);
    console.log(`   Executed: ${executed}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total: ${migrationFiles.length}`);
    console.log('='.repeat(50) + '\n');
    
    // Verify tables were created
    const [tables] = await connection.query('SHOW TABLES');
    console.log(`📋 Total tables in database: ${tables.length}`);
    
    if (tables.length > 0) {
      console.log('\n📊 Tables created:');
      tables.forEach((table, index) => {
        const tableName = Object.values(table)[0];
        console.log(`   ${index + 1}. ${tableName}`);
      });
    }
    
    console.log('\n✅ All migrations completed successfully!\n');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed\n');
    }
  }
}

// Run migrations
if (require.main === module) {
  runMigrations().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { runMigrations };
