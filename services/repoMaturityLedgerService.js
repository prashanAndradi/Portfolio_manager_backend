'use strict';

/**
 * Repo / Reverse Repo maturity (and premature-maturity) ledger posting.
 *
 * Repo (borrowing), per Finance's Leg 2 repayment entry:
 *   1. DR Repo liability 308       / CR Bank = principal
 *   2. DR Interest Payable 314     / CR Bank = interest_amount
 * The expense was already recognised by the daily accrual (DR 752 / CR 314), so maturity
 * only settles the payable. (Before the 2026-09-11 GL change this reversed the accrual
 * out of 752 and re-booked it to a separate maturity expense GL; with both keys on 752
 * that became a self-cancelling DR/CR 752 pair.)
 *
 * Reverse Repo (asset) is a single pair:
 *   DR Bank / CR Reverse Repo asset = principal + interest
 *
 * Shared by EOD and Premature Maturity so both produce the same journal.
 * Idempotent: skips if a maturity description already exists for the deal.
 */

const db = require('../config/database');
const accountMapping = require('./accountMappingService');
const { postLedgerEntry } = require('../controllers/ledgerController');
const { resolveRepoDealNumber } = require('../models/repoDealModel');

function isOk(result) {
  return result && result.success === true;
}

function toYmd(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function resolveBankCode(settlementMode) {
  if (!settlementMode) return null;
  const [rows] = await db.query(
    'SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
    [settlementMode]
  );
  return (rows[0] && rows[0].ledger_account_code) || null;
}

async function hasMaturityLedger(dealNumber, dealType) {
  const like =
    dealType === 'Reverse Repo'
      ? 'Reverse Repo Maturity - Deal %'
      : 'Repo Maturity - Deal %';
  const [rows] = await db.query(
    `SELECT 1 FROM ledger_entries
     WHERE deal_number = ? AND description LIKE ?
     LIMIT 1`,
    [dealNumber, like]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function markMatured(dealId) {
  await db.query("UPDATE repo_deals SET matured = 1, status = 'Matured' WHERE id = ?", [dealId]);
}

/**
 * @param {object} deal - repo_deals row (needs id, deal_number, deal_type, principal_amount,
 *   interest_amount, settlement_mode, maturity_date)
 * @param {{ entryDate?: string }} [options]
 * @returns {Promise<{success:boolean, posted:boolean, skipped?:string, error?:string}>}
 */
async function postRepoMaturityLedger(deal, { entryDate } = {}) {
  const dealNumber = resolveRepoDealNumber(deal);
  const dealType = deal.deal_type || 'Repo';
  const date = toYmd(entryDate || deal.maturity_date);
  if (!dealNumber || !date) {
    return { success: false, posted: false, error: 'missing deal number or entry date' };
  }

  if (await hasMaturityLedger(dealNumber, dealType)) {
    if (deal.id != null) await markMatured(deal.id);
    return { success: true, posted: false, skipped: 'already_posted' };
  }

  const bankAccount = await resolveBankCode(deal.settlement_mode);
  if (!bankAccount) {
    return { success: false, posted: false, error: 'no settlement bank account resolved' };
  }

  const principalAmount = Number(deal.principal_amount) || 0;
  const interestAmount = Number(deal.interest_amount) || 0;

  if (dealType === 'Reverse Repo') {
    // Principal clears the Reverse Repo asset; interest clears the receivable
    // the daily accrual built up, so neither GL is left carrying a balance.
    const [repoAsset, interestReceivable] = await Promise.all([
      accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REPO_REVERSE_REPO_ASSET),
      accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REPO_INTEREST_RECEIVABLE)
    ]);
    const description = `Reverse Repo Maturity - Deal ${dealNumber}`;

    if (principalAmount > 0) {
      const principalLeg = await postLedgerEntry({
        date,
        dr_account: bankAccount,
        cr_account: repoAsset,
        amount: principalAmount,
        deal_id: dealNumber,
        description
      });
      if (!isOk(principalLeg)) {
        return { success: false, posted: false, error: principalLeg && principalLeg.error };
      }
    }

    if (interestAmount > 0) {
      const interestLeg = await postLedgerEntry({
        date,
        dr_account: bankAccount,
        cr_account: interestReceivable,
        amount: interestAmount,
        deal_id: dealNumber,
        description
      });
      if (!isOk(interestLeg)) {
        return { success: false, posted: false, error: interestLeg && interestLeg.error };
      }
    }

    if (deal.id != null) await markMatured(deal.id);
    return { success: true, posted: true };
  }

  if (dealType !== 'Repo') {
    return { success: false, posted: false, error: `unsupported deal_type=${dealType}` };
  }

  const [liabilityAccount, interestPayable] = await Promise.all([
    accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_LIABILITY),
    accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_INTEREST_PAYABLE)
  ]);

  const description = `Repo Maturity - Deal ${dealNumber}`;

  if (principalAmount > 0) {
    const principalLeg = await postLedgerEntry({
      date,
      dr_account: liabilityAccount,
      cr_account: bankAccount,
      amount: principalAmount,
      deal_id: dealNumber,
      description
    });
    if (!isOk(principalLeg)) {
      return { success: false, posted: false, error: principalLeg && principalLeg.error };
    }
  }

  if (interestAmount > 0) {
    // Settle the accrued interest payable - no expense line; the daily accrual booked it.
    const interestLeg = await postLedgerEntry({
      date,
      dr_account: interestPayable,
      cr_account: bankAccount,
      amount: interestAmount,
      deal_id: dealNumber,
      description
    });
    if (!isOk(interestLeg)) {
      return { success: false, posted: false, error: interestLeg && interestLeg.error };
    }
  }

  if (deal.id != null) await markMatured(deal.id);
  return { success: true, posted: true };
}

module.exports = {
  postRepoMaturityLedger,
  hasRepoMaturityLedger: hasMaturityLedger,
  resolveRepoMaturityBankCode: resolveBankCode
};
