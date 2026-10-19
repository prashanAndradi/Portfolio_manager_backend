'use strict';

/**
 * Daily Cashflow Blotter - one day's cash movement, as a single combined
 * position across all banks.
 *
 *   opening balance (keyed in by hand)
 *     + maturities settling that day
 *     + / - deals value-dated that day
 *     - bank charges
 *   = closing balance
 *
 * Deal rows come from dailyMaturityCashflowService, which already builds both
 * halves - maturities, and the value-date settlements that Maturity Handling
 * deliberately hides. This asks it for both and arranges them into a cash
 * statement.
 *
 * Only FINAL-APPROVED deals count toward the closing balance. Anything still in
 * the approval chain is returned separately in `pending`, so the UI can show it
 * as outstanding work without it silently moving the bottom line. That is the
 * whole point: a closing balance that quietly included half-approved deals
 * would be wrong in a way nobody could see.
 */

const db = require('../config/database');
const { getDailyMaturityCashflow } = require('./dailyMaturityCashflowService');
const { getSystemDay } = require('../models/systemDayModel');

// Status vocabularies differ per product table - gsec uses final_approved,
// repo_deals uses Matured/Pending, money market uses Approved/Verified. These
// are the ones that mean "fully approved, cash will move".
const SETTLED_STATUSES = new Set([
  'final_approved',
  'matured',
  'settled',
  'approved',
  'closed',
  'completed'
]);

// Explicitly not cash: the deal is dead.
const DEAD_STATUSES = new Set(['cancelled', 'rejected', 'void', 'reversed']);

const normalise = (s) => String(s || '').trim().toLowerCase();

function toYmd(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * A deal counts toward the closing balance only when it is fully approved.
 * Anything else is either dead (excluded entirely) or still in the chain
 * (reported as pending).
 */
function classifyRow(row) {
  const status = normalise(row.status);
  if (DEAD_STATUSES.has(status)) return 'excluded';
  if (SETTLED_STATUSES.has(status)) return 'settled';
  return 'pending';
}

exports.getOpeningBalance = async (ymd) => {
  const [rows] = await db.query(
    'SELECT opening_balance, currency, notes, entered_by, updated_at FROM daily_cashflow_opening_balance WHERE balance_date = ?',
    [ymd]
  );
  if (!rows.length) return null;
  return {
    amount: Number(rows[0].opening_balance) || 0,
    currency: rows[0].currency || 'LKR',
    notes: rows[0].notes || '',
    entered_by: rows[0].entered_by || null,
    updated_at: rows[0].updated_at
  };
};

exports.setOpeningBalance = async (ymd, amount, { notes = null, enteredBy = null } = {}) => {
  const value = Number(amount);
  if (!Number.isFinite(value)) throw new Error('opening balance must be a number');
  await db.query(
    `INSERT INTO daily_cashflow_opening_balance (balance_date, opening_balance, notes, entered_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE opening_balance = VALUES(opening_balance),
                             notes = VALUES(notes),
                             entered_by = VALUES(entered_by)`,
    [ymd, value, notes, enteredBy]
  );
  return exports.getOpeningBalance(ymd);
};

// Which approval level a charge is waiting on, and how to label it.
const CHARGE_LEVELS = {
  pending_verification: { stage: 'back_office_verifier', label: 'Awaiting verification', posted: false },
  verified: { stage: 'back_office_final', label: 'Awaiting final approval', posted: false },
  approved: { stage: null, label: 'Posted to GL', posted: true },
  rejected: { stage: null, label: 'Rejected', posted: false },
  legacy: { stage: null, label: 'Pre-dates approval', posted: false }
};

exports.getBankCharges = async (ymd) => {
  const [rows] = await db.query(
    `SELECT id, entry_date, bank_name, bank_account_code, description, amount,
            charge_type, reference_no, account_code, status, created_by, created_by_user_id,
            verified_by, verified_by_user_id, verified_at,
            approved_by, approved_by_user_id, approved_at,
            ledger_entry_ids, rejected_by, reject_reason
       FROM bank_charges
      WHERE entry_date = ? AND status <> 'rejected'
      ORDER BY id`,
    [ymd]
  );
  return (rows || []).map((r) => {
    const level = CHARGE_LEVELS[normalise(r.status)] || { stage: null, label: r.status, posted: false };
    return {
      ...r,
      amount: Number(r.amount) || 0,
      entry_date: toYmd(r.entry_date),
      level_stage: level.stage,
      level_label: level.label,
      posted: level.posted
    };
  });
};

/**
 * Build the day's blotter.
 *
 * Returns deal rows split into `settled` (counted) and `pending` (shown but not
 * counted), the bank charges, and the arithmetic tying opening to closing.
 */
exports.getDailyCashflowBlotter = async (dateStr, options = {}) => {
  const ymd = toYmd(dateStr);
  if (!ymd) throw new Error('a date is required');

  const { type = 'all' } = options;

  const [cashflow, openingRow, charges, systemRow] = await Promise.all([
    getDailyMaturityCashflow(ymd, { type, includeSettlements: true }),
    exports.getOpeningBalance(ymd),
    exports.getBankCharges(ymd),
    getSystemDay().catch(() => null)
  ]);

  const settled = [];
  const pending = [];
  for (const row of cashflow.rows || []) {
    const bucket = classifyRow(row);
    if (bucket === 'excluded') continue;
    // settlement_value is already signed: negative for 'Less' (cash out).
    const enriched = { ...row, settlement_value: round2(row.settlement_value) };
    (bucket === 'settled' ? settled : pending).push(enriched);
  }

  const sumSigned = (rows) => round2(rows.reduce((s, r) => s + (Number(r.settlement_value) || 0), 0));

  const inflows = round2(
    settled.filter((r) => r.settlement_value > 0).reduce((s, r) => s + r.settlement_value, 0)
  );
  const outflows = round2(
    settled.filter((r) => r.settlement_value < 0).reduce((s, r) => s + r.settlement_value, 0)
  );

  // Charges reduce cash from the moment they are entered, whether or not the
  // ledger posting has been approved yet - the money has already left.
  const chargeTotal = round2(charges.reduce((s, c) => s + c.amount, 0));
  const chargesAwaitingApproval = charges.filter(
    (c) => normalise(c.status) === 'pending_verification' || normalise(c.status) === 'verified'
  ).length;

  const opening = openingRow ? openingRow.amount : null;
  const netMovement = round2(inflows + outflows - chargeTotal);
  const closing = opening === null ? null : round2(opening + netMovement);

  return {
    date: ymd,
    system_date: toYmd(systemRow && (systemRow.system_date || systemRow.systemDay)) || null,
    view_mode: cashflow.view_mode,
    opening_balance: opening,
    opening_balance_entered: openingRow !== null,
    opening_balance_meta: openingRow,
    rows: settled,
    pending,
    charges,
    totals: {
      inflows,
      outflows,
      net_deal_movement: sumSigned(settled),
      bank_charges: chargeTotal,
      net_movement: netMovement,
      closing_balance: closing,
      // What the closing balance WOULD be if everything pending were approved.
      // Shown as context for the warning, never as the closing figure.
      pending_value: sumSigned(pending),
      provisional_closing: opening === null ? null : round2(opening + netMovement + sumSigned(pending))
    },
    pending_summary: {
      deal_count: pending.length,
      charges_awaiting_approval: chargesAwaitingApproval,
      blocking: pending.length > 0 || chargesAwaitingApproval > 0
    }
  };
};

exports.CHARGE_LEVELS = CHARGE_LEVELS;
exports.SETTLED_STATUSES = SETTLED_STATUSES;
exports.classifyRow = classifyRow;
