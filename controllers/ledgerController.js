const db = require('../config/db');

// Helper to get account_id from account_code
async function getAccountIdByCode(account_code) {
  const [rows] = await db.query(
    'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [account_code]
  );
  if (rows.length === 0) throw new Error(`Account code not found: ${account_code}`);
  return rows[0].id;
}

exports.postLedgerEntry = async function(entry) {
  console.log('postLedgerEntry function called');
  const { date, dr_account, cr_account, amount, deal_id, description } = entry;
  console.log('EOD Posting:', entry);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const dr_account_id = await getAccountIdByCode(dr_account);
    const cr_account_id = await getAccountIdByCode(cr_account);
    console.log('Account IDs:', { dr_account_id, cr_account_id });
    if (!dr_account_id || !cr_account_id) {
      throw new Error(`Missing account ID(s): dr_account_id=${dr_account_id}, cr_account_id=${cr_account_id}`);
    }

    // Insert debit entry
    const [debitResult] = await connection.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
      [date, dr_account_id, amount, deal_id, description, 'LKR']
    );
    console.log('Debit insert result:', debitResult);

    // Insert credit entry
    const [creditResult] = await connection.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, 0, ?, ?, ?, ?)`,
      [date, cr_account_id, amount, deal_id, description, 'LKR']
    );
    console.log('Credit insert result:', creditResult);

    await connection.commit();
    console.log('Ledger entries inserted for deal', deal_id);
    return { success: true };
  } catch (err) {
    await connection.rollback();
    console.error('Ledger entry insert error:', err);
    return { success: false, error: err.message };
  } finally {
    connection.release();
  }
};
