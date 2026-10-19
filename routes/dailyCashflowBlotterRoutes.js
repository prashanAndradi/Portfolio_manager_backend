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
const { checkAuth } = require('../middleware/auth');
const { resolveEffectiveWorkflowAuth } = require('../utils/effectiveWorkflowAuth');
const { actorCanActAtStage, requiredRolesForStage } = require('../utils/workflowStageAuth');

// Dr this, Cr the bank the charge came out of.
const BANK_CHARGE_EXPENSE_CODE = '651-101-120-518-44';

/**
 * Two-level approval, the same chain the deal products use:
 *
 *   pending_verification --verify--> verified --approve--> approved (posted)
 *
 * Deliberately no per-deal / per-day limit check: a bank charge is a fee, not
 * a dealing position, so the dealer limits that gate deal approval do not
 * apply. Authority here is role-based only.
 */
const STAGE_FOR_STATUS = {
  pending_verification: 'back_office_verifier',
  verified: 'back_office_final'
};

/**
 * The acting user, resolved from the DATABASE rather than from the JWT.
 * A token is issued for seven days, so a role revoked yesterday would still be
 * presented by a token minted before the change - reading authorizer_assignments
 * live means a revocation takes effect immediately.
 */
async function resolveActor(req) {
  const id = req.user && (req.user.id || req.user.userId);
  if (!id) return null;
  return resolveEffectiveWorkflowAuth(id);
}

function forbid(res, stageKey, actorRow) {
  const needed = requiredRolesForStage(stageKey).join(' or ');
  return res.status(403).json({
    success: false,
    message: `This step needs ${needed}. You are signed in as ${actorRow ? actorRow.role : 'an unassigned user'}.`,
    required_roles: requiredRolesForStage(stageKey),
    your_role: actorRow ? actorRow.role : null
  });
}

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

async function accountByCode(code) {
  const [rows] = await db.query(
    'SELECT id, account_code, name FROM chart_of_accounts WHERE account_code = ? AND is_active = TRUE',
    [code]
  );
  return rows[0] || null;
}

router.get('/', checkAuth, async (req, res) => {
  try {
    const date = ymd(req.query.date);
    if (!isYmd(date)) return res.status(400).json({ success: false, message: 'date (YYYY-MM-DD) is required' });
    const [data, actorRow] = await Promise.all([
      blotter.getDailyCashflowBlotter(date, { type: req.query.type || 'all' }),
      resolveActor(req)
    ]);

    // Tell the page what this user may do, rather than letting it guess from a
    // role string. The server still enforces every action independently - this
    // only decides which buttons are worth showing.
    const canVerify = actorCanActAtStage(actorRow, 'back_office_verifier');
    const canApprove = actorCanActAtStage(actorRow, 'back_office_final');
    const myId = actorRow ? actorRow.id : null;
    const isAdmin = Boolean(actorRow && actorRow.isAdmin);

    data.charges = data.charges.map((c) => ({
      ...c,
      can_verify:
        c.status === 'pending_verification' &&
        canVerify &&
        (isAdmin || c.created_by_user_id !== myId),
      can_approve:
        c.status === 'verified' &&
        canApprove &&
        (isAdmin || c.verified_by_user_id !== myId),
      can_delete:
        c.status === 'pending_verification' && (isAdmin || c.created_by_user_id === myId)
    }));

    res.json({
      success: true,
      ...data,
      viewer: {
        username: actorRow ? actorRow.username : null,
        role: actorRow ? actorRow.role : null,
        is_admin: isAdmin,
        can_verify: canVerify,
        can_approve: canApprove
      }
    });
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

router.put('/opening-balance', checkAuth, async (req, res) => {
  try {
    const actorRow = await resolveActor(req);
    const date = ymd(req.body.date);
    if (!isYmd(date)) return res.status(400).json({ success: false, message: 'date (YYYY-MM-DD) is required' });
    const amount = Number(req.body.opening_balance);
    if (!Number.isFinite(amount)) {
      return res.status(400).json({ success: false, message: 'opening_balance must be a number' });
    }
    const saved = await blotter.setOpeningBalance(date, amount, {
      notes: req.body.notes || null,
      enteredBy: actorRow ? actorRow.username : null
    });
    res.json({ success: true, opening_balance: saved });
  } catch (err) {
    console.error('Saving opening balance failed:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/charges', checkAuth, async (req, res) => {
  try {
    const actorRow = await resolveActor(req);
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
          reference_no, account_code, status, created_by, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_verification', ?, ?)`,
      [
        date,
        bank.name,
        bankAccountCode,
        String(description).trim(),
        amount,
        chargeType || 'bank_charge',
        referenceNo || null,
        BANK_CHARGE_EXPENSE_CODE,
        actorRow ? actorRow.username : null,
        actorRow ? actorRow.id : null
      ]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('Saving bank charge failed:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Level 1 - verification. Moves the charge on to the final approver. Nothing
 * is posted here; the ledger is only touched at the final level.
 */
router.post('/charges/:id/verify', checkAuth, async (req, res) => {
  try {
    const actorRow = await resolveActor(req);
    const [[charge]] = await db.query('SELECT * FROM bank_charges WHERE id = ?', [req.params.id]);
    if (!charge) return res.status(404).json({ success: false, message: 'charge not found' });

    if (charge.status !== 'pending_verification') {
      return res.status(409).json({
        success: false,
        message:
          charge.status === 'verified'
            ? 'charge is already verified and waiting for final approval'
            : `charge cannot be verified from status "${charge.status}"`
      });
    }
    if (!actorCanActAtStage(actorRow, 'back_office_verifier')) {
      return forbid(res, 'back_office_verifier', actorRow);
    }
    // Maker-checker: whoever entered the charge cannot also verify it.
    if (!actorRow.isAdmin && charge.created_by_user_id && charge.created_by_user_id === actorRow.id) {
      return res.status(403).json({
        success: false,
        message: 'you entered this charge, so it has to be verified by someone else'
      });
    }

    await db.query(
      `UPDATE bank_charges
          SET status = 'verified', verified_by = ?, verified_by_user_id = ?, verified_at = NOW()
        WHERE id = ?`,
      [actorRow.username, actorRow.id, charge.id]
    );
    res.json({ success: true, status: 'verified', next_level: 'back_office_final' });
  } catch (err) {
    console.error('Verifying bank charge failed:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Level 2 - final approval, which posts. The GL write and the status change go
 * in one transaction: a charge marked approved with no ledger entries behind it
 * (or the reverse) would be invisible until someone reconciled by hand.
 */
router.post('/charges/:id/approve', checkAuth, async (req, res) => {
  const connection = await db.pool.getConnection();
  try {
    const actorRow = await resolveActor(req);
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
    if (charge.status === 'pending_verification') {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: 'charge has to be verified by a back office verifier before final approval'
      });
    }
    if (!actorCanActAtStage(actorRow, 'back_office_final')) {
      await connection.rollback();
      return forbid(res, 'back_office_final', actorRow);
    }
    // Maker-checker across the two levels: the verifier cannot also give final
    // approval, so two different people always stand behind a posting.
    if (!actorRow.isAdmin && charge.verified_by_user_id && charge.verified_by_user_id === actorRow.id) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: 'you verified this charge, so final approval has to come from someone else'
      });
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
          SET status = 'approved', approved_by = ?, approved_by_user_id = ?,
              approved_at = NOW(), ledger_entry_ids = ?
        WHERE id = ?`,
      [actorRow.username, actorRow.id, ids.join(','), charge.id]
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

/**
 * Reject at whichever level the charge is currently sitting at - a verifier can
 * turn one back, and so can the final approver.
 */
router.post('/charges/:id/reject', checkAuth, async (req, res) => {
  try {
    const actorRow = await resolveActor(req);
    const [[charge]] = await db.query('SELECT status FROM bank_charges WHERE id = ?', [req.params.id]);
    if (!charge) return res.status(404).json({ success: false, message: 'charge not found' });
    if (charge.status === 'approved') {
      return res.status(409).json({
        success: false,
        message: 'charge is already posted to the ledger; it has to be reversed rather than rejected'
      });
    }
    const stageKey = STAGE_FOR_STATUS[charge.status];
    if (!stageKey) {
      return res.status(409).json({ success: false, message: `charge cannot be rejected from status "${charge.status}"` });
    }
    if (!actorCanActAtStage(actorRow, stageKey)) return forbid(res, stageKey, actorRow);

    await db.query(
      "UPDATE bank_charges SET status = 'rejected', rejected_by = ?, rejected_at = NOW(), reject_reason = ? WHERE id = ?",
      [actorRow.username, req.body.reason || null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/** Only an unposted charge can be deleted; a posted one needs a reversal. */
router.delete('/charges/:id', checkAuth, async (req, res) => {
  try {
    const actorRow = await resolveActor(req);
    const [[charge]] = await db.query(
      'SELECT status, created_by_user_id FROM bank_charges WHERE id = ?',
      [req.params.id]
    );
    if (!charge) return res.status(404).json({ success: false, message: 'charge not found' });
    if (charge.status === 'approved') {
      return res.status(409).json({
        success: false,
        message: 'charge is posted to the ledger and cannot be deleted; reverse it instead'
      });
    }
    // Once a verifier has signed it, withdrawing it is a reject, not a delete -
    // otherwise the verification would vanish without trace.
    if (charge.status !== 'pending_verification') {
      return res.status(409).json({
        success: false,
        message: 'charge has already been verified; reject it rather than deleting it'
      });
    }
    if (!actorRow || (!actorRow.isAdmin && charge.created_by_user_id !== actorRow.id)) {
      return res.status(403).json({
        success: false,
        message: 'only the person who entered this charge can delete it'
      });
    }
    await db.query('DELETE FROM bank_charges WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
