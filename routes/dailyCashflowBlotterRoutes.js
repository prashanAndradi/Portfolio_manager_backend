'use strict';

/**
 * Daily Cashflow Blotter API.
 *
 *   GET    /api/daily-cashflow-blotter            one day's blotter
 *   PUT    /api/daily-cashflow-blotter/opening-balance
 *   POST   /api/daily-cashflow-blotter/charges    enter a bank charge
 *   POST   /api/daily-cashflow-blotter/charges/:id/approve   posts to the GL
 *   POST   /api/daily-cashflow-blotter/charges/:id/reject
 *   DELETE /api/daily-cashflow-blotter/charges/:id
 *
 * A charge affects the blotter as soon as it is entered - the money has already
 * left the bank - but reaches the general ledger only on approval, matching
 * every other posting path in this system.
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const blotter = require('../services/dailyCashflowBlotterService');

// Dr this, Cr the bank the charge came out of.
const BANK_CHARGE_EXPENSE_CODE = '651-101-120-518-44';

/**
 * Normalise to YYYY-MM-DD. mysql2 hands DATE columns back as Date objects, so
 * slicing the string form yields "Thu Oct 15" - which silently produced ledger
 * rows with an invalid entry_date until this was fixed. Local getters, not
 * toISOString, so a date never shifts a day across the timezone offset.
 */
function ymd(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');

const actor = (req) =>
  (req.user && (req.user.username || req.user.name || req.user.email)) ||
  req.body?.created_by ||
  req.body?.approved_by ||
  null;

async function accountByCode(code) {
  const [rows] = await db.query(
    'SELECT id, account_code, name FROM chart_of_accounts WHERE account_code = ? AND is_active = TRUE',
    [code]
  );
  return rows[0] || null;
}

router.get('/', async (req, res) => {
  try {
    const date = ymd(req.query.date);
    if (!isYmd(date)) return res.status(400).json({ success: false, message: 'date (YYYY-MM-DD) is required' });
    const data = await blotter.getDailyCashflowBlotter(date, { type: req.query.type || 'all' });
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('Daily cashflow blotter failed:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Bank accounts the user can charge against, for the manual row's dropdown.
 *
 * The 131-101-410 range holds the cash accounts, but not everything in it is a
 * chargeable bank account: -000- is the "Cash and Cash Equivalents" rollup and
 * -206- is Reverse Repo. Crediting a charge to either would be wrong, so both
 * are excluded rather than left for the user to avoid.
 */
const NON_BANK_CASH_CODES = ['131-101-410-000-44', '131-101-410-206-44'];

router.get('/bank-accounts', async (_req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, account_code, name FROM chart_of_accounts
        WHERE is_active = TRUE
          AND account_code LIKE '131-101-410-%'
          AND account_code NOT IN (?)
          AND LOWER(name) NOT LIKE '%repo%'
        ORDER BY name`,
      [NON_BANK_CASH_CODES]
    );
    res.json({ success: true, accounts: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/opening-balance', async (req, res) => {
  try {
    const date = ymd(req.body.date);
    if (!isYmd(date)) return res.status(400).json({ success: false, message: 'date (YYYY-MM-DD) is required' });
    const amount = Number(req.body.opening_balance);
    if (!Number.isFinite(amount)) {
      return res.status(400).json({ success: false, message: 'opening_balance must be a number' });
    }
    const saved = await blotter.setOpeningBalance(date, amount, {
      notes: req.body.notes || null,
      enteredBy: actor(req)
    });
    res.json({ success: true, opening_balance: saved });
  } catch (err) {
    console.error('Saving opening balance failed:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/charges', async (req, res) => {
  try {
    const date = ymd(req.body.entry_date);
    const amount = Number(req.body.amount);
    const { description, bank_account_code: bankAccountCode, reference_no: referenceNo, charge_type: chargeType } = req.body;

    if (!isYmd(date)) return res.status(400).json({ success: false, message: 'entry_date (YYYY-MM-DD) is required' });
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'amount must be greater than zero' });
    }
    if (!description || !String(description).trim()) {
      return res.status(400).json({ success: false, message: 'description is required' });
    }
    if (!bankAccountCode) {
      return res.status(400).json({ success: false, message: 'bank_account_code is required' });
    }

    const bank = await accountByCode(bankAccountCode);
    if (!bank) {
      return res.status(400).json({ success: false, message: `unknown bank account ${bankAccountCode}` });
    }

    const [result] = await db.query(
      `INSERT INTO bank_charges
         (entry_date, bank_name, bank_account_code, description, amount, charge_type,
          reference_no, account_code, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?)`,
      [
        date,
        bank.name,
        bankAccountCode,
        String(description).trim(),
        amount,
        chargeType || 'bank_charge',
        referenceNo || null,
        BANK_CHARGE_EXPENSE_CODE,
        actor(req)
      ]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('Saving bank charge failed:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Approve and post. The GL write and the status change go in one transaction:
 * a charge marked approved with no ledger entries behind it (or the reverse)
 * would be invisible until someone reconciled by hand.
 */
router.post('/charges/:id/approve', async (req, res) => {
  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();

    const [[charge]] = await connection.query(
      'SELECT * FROM bank_charges WHERE id = ? FOR UPDATE',
      [req.params.id]
    );
    if (!charge) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'charge not found' });
    }
    if (charge.status === 'approved') {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'charge is already approved and posted' });
    }
    if (charge.status === 'rejected') {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'charge was rejected; enter a new one' });
    }

    const [[expense]] = await connection.query(
      'SELECT id, name FROM chart_of_accounts WHERE account_code = ? AND is_active = TRUE',
      [charge.account_code || BANK_CHARGE_EXPENSE_CODE]
    );
    const [[bank]] = await connection.query(
      'SELECT id, name FROM chart_of_accounts WHERE account_code = ? AND is_active = TRUE',
      [charge.bank_account_code]
    );
    if (!expense || !bank) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: `cannot post: ${!expense ? 'bank charges expense account' : 'bank account'} not found in the chart of accounts`
      });
    }

    const amount = Number(charge.amount) || 0;
    const entryDate = ymd(charge.entry_date);
    // Never write a ledger row with a date we could not read - an entry dated
    // "Invalid Date" is invisible to every report that filters by entry_date.
    if (!isYmd(entryDate)) {
      await connection.rollback();
      return res.status(500).json({
        success: false,
        message: `cannot post: charge ${charge.id} has an unreadable entry_date`
      });
    }
    const description = `Bank Charges - ${charge.description}${charge.reference_no ? ` (${charge.reference_no})` : ''}`;
    const dealNumber = `BC/${entryDate.replace(/-/g, '')}/${String(charge.id).padStart(4, '0')}`;

    const ids = [];
    for (const leg of [
      { account_id: expense.id, debit: amount, credit: 0 },
      { account_id: bank.id, debit: 0, credit: amount }
    ]) {
      const [r] = await connection.query(
        `INSERT INTO ledger_entries
           (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
         VALUES (?, ?, ?, ?, ?, ?, 'LKR')`,
        [entryDate, leg.account_id, leg.debit, leg.credit, dealNumber, description]
      );
      ids.push(r.insertId);
    }

    await connection.query(
      `UPDATE bank_charges
          SET status = 'approved', approved_by = ?, approved_at = NOW(), ledger_entry_ids = ?
        WHERE id = ?`,
      [actor(req), ids.join(','), charge.id]
    );

    await connection.commit();
    res.json({
      success: true,
      deal_number: dealNumber,
      ledger_entry_ids: ids,
      posting: `Dr ${expense.name} ${amount.toFixed(2)} / Cr ${bank.name} ${amount.toFixed(2)}`
    });
  } catch (err) {
    await connection.rollback();
    console.error('Approving bank charge failed:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    connection.release();
  }
});

router.post('/charges/:id/reject', async (req, res) => {
  try {
    const [[charge]] = await db.query('SELECT status FROM bank_charges WHERE id = ?', [req.params.id]);
    if (!charge) return res.status(404).json({ success: false, message: 'charge not found' });
    if (charge.status === 'approved') {
      return res.status(409).json({
        success: false,
        message: 'charge is already posted to the ledger; it has to be reversed rather than rejected'
      });
    }
    await db.query(
      "UPDATE bank_charges SET status = 'rejected', rejected_by = ?, rejected_at = NOW(), reject_reason = ? WHERE id = ?",
      [actor(req), req.body.reason || null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/** Only an unposted charge can be deleted; a posted one needs a reversal. */
router.delete('/charges/:id', async (req, res) => {
  try {
    const [[charge]] = await db.query('SELECT status FROM bank_charges WHERE id = ?', [req.params.id]);
    if (!charge) return res.status(404).json({ success: false, message: 'charge not found' });
    if (charge.status === 'approved') {
      return res.status(409).json({
        success: false,
        message: 'charge is posted to the ledger and cannot be deleted; reverse it instead'
      });
    }
    await db.query('DELETE FROM bank_charges WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
