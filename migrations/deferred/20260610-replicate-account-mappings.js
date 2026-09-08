/**
 * Replicate account_mappings into another environment of this project,
 * creating any missing chart_of_accounts (and account_types) rows along
 * the way. Reads the JSON produced by scripts/export-account-mappings.js
 * (run on the source environment, excludes buyback-only accounts).
 *
 * Steps per exported row:
 *   1. Ensure account_types row exists (matched by name) - create if missing.
 *   2. Resolve parent chart_of_accounts row by code, if any (best effort).
 *   3. Ensure chart_of_accounts row exists for account_code - create if missing.
 *   4. Upsert account_mappings (mapping_key -> account_code).
 *
 * Run on the TARGET database:
 *   node migrations/20260610-replicate-account-mappings.js [input-path]
 *
 * Default input: migrations/data/account-mappings-export.json
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');

async function run() {
  const inputPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, 'data', 'account-mappings-export.json');

  if (!fs.existsSync(inputPath)) {
    console.error(`Export file not found: ${inputPath}`);
    console.error('Run scripts/export-account-mappings.js on the source environment first, then copy the JSON here.');
    process.exit(1);
  }

  const rows = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  let typesCreated = 0;
  let accountsCreated = 0;
  let mappingsUpserted = 0;

  for (const row of rows) {
    // 1. Ensure account_types row exists.
    const [typeRows] = await db.query(
      'SELECT id FROM account_types WHERE name = ? LIMIT 1',
      [row.account_type_name]
    );
    let accountTypeId;
    if (typeRows.length) {
      accountTypeId = typeRows[0].id;
    } else {
      const [result] = await db.query(
        'INSERT INTO account_types (name, category, description) VALUES (?, ?, ?)',
        [row.account_type_name, row.account_type_category, 'Auto-created during account mapping replication']
      );
      accountTypeId = result.insertId;
      typesCreated++;
      console.log(`Created account_types row: ${row.account_type_name} (${row.account_type_category})`);
    }

    // 2. Resolve parent chart_of_accounts row, best effort.
    let parentAccountId = null;
    if (row.parent_account_code) {
      const [parentRows] = await db.query(
        'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
        [row.parent_account_code]
      );
      if (parentRows.length) {
        parentAccountId = parentRows[0].id;
      } else {
        console.warn(
          `Parent account ${row.parent_account_code} for ${row.account_code} not found on target; creating without a parent link.`
        );
      }
    }

    // 3. Ensure chart_of_accounts row exists.
    const [coaRows] = await db.query(
      'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
      [row.account_code]
    );
    if (!coaRows.length) {
      await db.query(
        `INSERT INTO chart_of_accounts (account_code, name, account_type_id, parent_account_id, description, is_active)
         VALUES (?, ?, ?, ?, ?, TRUE)`,
        [row.account_code, row.account_name, accountTypeId, parentAccountId, row.account_description]
      );
      accountsCreated++;
      console.log(`Created chart_of_accounts row: ${row.account_code} (${row.account_name})`);
    }

    // 4. Upsert account_mappings.
    await db.query(
      `INSERT INTO account_mappings (mapping_key, account_code, description, is_active, created_at, updated_at)
       VALUES (?, ?, ?, TRUE, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         account_code = VALUES(account_code),
         description = VALUES(description),
         is_active = TRUE,
         updated_at = NOW()`,
      [row.mapping_key, row.account_code, row.mapping_description]
    );
    mappingsUpserted++;
  }

  console.log(
    `Done. account_types created: ${typesCreated}, chart_of_accounts created: ${accountsCreated}, account_mappings upserted: ${mappingsUpserted}`
  );
  process.exit(0);
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = run;
