const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const csvPath = path.join(__dirname, '../../portfolio_manager/src/pages/Chart of accounts.csv');

function inferCategory(section) {
  if (/ASSET|LIABILITY|RETAINED PROFIT/i.test(section)) return 'BS';
  if (/EXPENSE|INCOME|TAX/i.test(section)) return 'PL';
  return 'BS';
}

(async () => {
  try {
    // 1. Delete all existing accounts
    await db.query('DELETE FROM chart_of_accounts');
    console.log('Deleted all existing accounts.');

    // 2. Read and parse CSV
    const raw = fs.readFileSync(csvPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    let section = '';
    let inserted = 0;
    for (let i = 0; i < lines.length; ++i) {
      const line = lines[i].trim();
      if (!line || line.startsWith(',')) continue;
      // Section header
      if (/^(ASSET|LIABILITY|EXPENSES|DIRECT INCOME|OTHER INCOME|TAX|RETAINED PROFITS)/i.test(line.replace(/,/g, ''))) {
        section = line.replace(/,/g, '').trim();
        continue;
      }
      // Data row
      const parts = line.split(',');
      if (parts.length < 3) continue;
      const [account_code, name, active] = parts.map(s => s.trim().replace(/^"|"$/g, ''));
      if (!/^\d/.test(account_code)) continue; // skip non-account rows
      const is_active = /yes/i.test(active);
      const category = inferCategory(section);
      const type = 'GL';
      // Extract type name from name (first word)
      const typeName = name.split(' ')[0];
      // Find account_type_id
      const [rows] = await db.query('SELECT id FROM account_types WHERE name LIKE ?', [`%${typeName}%`]);
      const account_type_id = rows[0]?.id;
      if (!account_type_id) {
        console.warn(`Skipping account ${account_code} (${name}): account_type_id not found for type '${typeName}'`);
        continue;
      }
      // Insert
      await db.query(
        'INSERT INTO chart_of_accounts (account_code, name, is_active, category, type, account_type_id) VALUES (?, ?, ?, ?, ?, ?)',
        [account_code, name, is_active, category, type, account_type_id]
      );
      inserted++;
    }
    console.log(`Imported ${inserted} accounts from CSV.`);
    process.exit(0);
  } catch (err) {
    console.error('Error importing chart of accounts:', err);
    process.exit(1);
  }
})(); 