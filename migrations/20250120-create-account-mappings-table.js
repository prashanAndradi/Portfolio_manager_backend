const db = require('../config/db');

async function createAccountMappingsTable() {
  try {
    console.log('Creating account_mappings table...');

    // Create account_mappings table WITHOUT foreign key first
    // Note: Using utf8mb4_0900_ai_ci collation to match chart_of_accounts table
    await db.query(`
      CREATE TABLE IF NOT EXISTS account_mappings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        mapping_key VARCHAR(100) NOT NULL UNIQUE,
        account_code VARCHAR(20) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_mapping_key (mapping_key),
        INDEX idx_account_code (account_code),
        INDEX idx_is_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    console.log('Account mappings table created successfully');

    // Note: We do NOT insert default mappings here because:
    // 1. The account codes may not exist in chart_of_accounts yet
    // 2. This would cause FK constraint errors when the constraint is added
    // Default mappings should be added later via API or a separate script after chart_of_accounts is populated
    
    // Before adding FK constraint, check if chart_of_accounts exists and clean up invalid rows
    try {
      const [tables] = await db.query(`
        SELECT TABLE_NAME 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'chart_of_accounts'
      `);
      
      if (tables.length > 0) {
        // Table exists, remove any rows with invalid account_code references
        const [invalidRows] = await db.query(`
          SELECT am.id 
          FROM account_mappings am
          LEFT JOIN chart_of_accounts coa ON am.account_code = coa.account_code
          WHERE coa.account_code IS NULL
        `);
        
        if (invalidRows.length > 0) {
          console.log(`Removing ${invalidRows.length} rows with invalid account_code references...`);
          await db.query(`
            DELETE am FROM account_mappings am
            LEFT JOIN chart_of_accounts coa ON am.account_code = coa.account_code
            WHERE coa.account_code IS NULL
          `);
        }
      }
    } catch (err) {
      // If chart_of_accounts doesn't exist, that's okay - FK will be deferred
      console.log('Note: chart_of_accounts may not exist yet, FK constraint will be deferred');
    }
    
    // Add foreign key constraint separately. Best-effort only: despite the
    // comment this used to have claiming "the migration runner will
    // automatically defer this", that deferred-statement mechanism only
    // applies to raw .sql files parsed by the runner - it has no visibility
    // into queries made from inside a .js migration's own function body, so
    // this call was never actually deferred. chart_of_accounts is created by
    // a LATER migration in the sequence (create-chart-of-accounts.sql, via
    // getMigrationFiles()'s special-case reordering), so this FK add is
    // expected to fail here on a fresh database - that must never block
    // every other table's migration behind it in the chain.
    try {
      await db.query(`
        ALTER TABLE account_mappings
        ADD CONSTRAINT fk_account_mappings_account_code
        FOREIGN KEY (account_code) REFERENCES chart_of_accounts(account_code)
        ON DELETE RESTRICT ON UPDATE CASCADE
      `);
      console.log('Foreign key constraint added successfully');
    } catch (fkError) {
      console.warn('⚠ Skipping account_mappings FK constraint for now (non-fatal):', fkError.message);
      console.warn('  It will be added once chart_of_accounts exists with an index on account_code.');
    }
    
    console.log('Note: Default account mappings should be added via API or admin interface after chart_of_accounts is populated');

  } catch (error) {
    console.error('Error creating account_mappings table:', error);
    throw error;
  }
}

// Run migration if called directly
if (require.main === module) {
  createAccountMappingsTable()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = createAccountMappingsTable;
