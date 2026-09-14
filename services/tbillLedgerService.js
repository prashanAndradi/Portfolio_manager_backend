/**
 * T-Bill ledger posting: final-approval Buy/Sell entries, EOD daily discount
 * accrual, and maturity (redemption) entries. Mirrors the GSEC pattern in
 * gsecApprovalLedgerService.js / gsecMaturityLedgerService.js.
 *
 * T-Bills are pure discount instruments: the asset is carried at cost
 * (settlement_amount) and accreted daily toward face value. The accreted
 * amount sits in TBILL_ACCRUAL_ASSET (Interest Receivable T-Bill - Trading)
 * against TBILL_ACCRUAL_INCOME (Interest Accrual P&L T-Bill).
 *
 *   Buy (final approval):
 *     DR  Treasury Bills - Trading A/c   = settlement_amount (cost)
 *     CR  Bank (settlement)              = settlement_amount
 *
 *   EOD Daily Accrual (per remaining face, while value_date <= system day < maturity):
 *     DR  Interest Receivable T-Bill - Trading
 *     CR  Interest Accrual P&L T-Bill
 *
 *   Sell (final approval, before maturity):
 *     DR  Bank (settlement)                    = sale proceeds
 *     CR  Treasury Bills - Trading A/c         = proportional cost of sold face
 *     CR  Interest Receivable T-Bill - Trading = proportional accrued receivable reversed
 *     CR/DR Profit/Loss on Sales of T-Bills    = plug (gain CR / loss DR)
 *
 *   Maturity (redemption) — Finance entry only (no P&L plug, no income reclass):
 *     DR  Bank (settlement)                    = remaining face value (par)
 *     CR  Treasury Bills - Trading A/c         = remaining cost
 *     CR  Interest Receivable T-Bill - Trading = face − remaining cost
 *         (clears the accrued receivable; any tiny rounding vs accrued_interest_to_date
 *          is absorbed here so the three lines always balance)
 */

const db = require('../config/database');
const accountMapping = require('./accountMappingService');
const ledgerController = require('../controllers/ledgerController');

const DEFAULT_TBILL_TRADING_CODE = '131-101-350-104-44';
const DEFAULT_TBILL_ACCRUAL_ASSET_CODE = '131-101-350-122-44';
// Was 467-101-190-482-44 (Interest Accrual P&L TBill). Moved to the Interest
// Received account in the 2026-09-11 GL mapping change, so it deliberately
// matches DEFAULT_TBILL_INTEREST_RECEIVED_CODE below.
const DEFAULT_TBILL_ACCRUAL_INCOME_CODE = '358-101-130-410-44';
const DEFAULT_TBILL_INTEREST_RECEIVED_CODE = '358-101-130-410-44';
const DEFAULT_TBILL_CAPITAL_GAIN_LOSS_CODE = '358-101-130-392-44';
const DEFAULT_TBILL_BANK_CODE = '131-101-410-182-44';

const ACCRUAL_DESCRIPTION_PREFIX = 'TBill Daily Accrual for Deal';
const MATURITY_DESCRIPTION_PREFIX = 'TBill Maturity - Redemption -';
const MATURITY_INCOME_DESCRIPTION_PREFIX = 'TBill Maturity - Interest Recognition -';

function truncate8(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n * 1e8) / 1e8;
}

function toYmd(dateLike) {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** DR/CR bank: settlement_accounts by settlement_mode, else TBILL_DEFAULT_SETTLEMENT mapping, else hard default. */
async function resolveTbillBankCode(settlementMode) {
  if (settlementMode) {
    try {
      const [rows] = await db.query(
        'SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
        [settlementMode]
      );
      if (rows && rows.length && rows[0].ledger_account_code) {
        return rows[0].ledger_account_code;
      }
    } catch (e) {
      console.warn('TBill settlement_accounts lookup failed:', e.message);
    }
  }
  const mapped = await accountMapping.getAccountCodeOptional(
    accountMapping.MAPPING_KEYS.TBILL_DEFAULT_SETTLEMENT
  );
  return mapped || DEFAULT_TBILL_BANK_CODE;
}

async function getTradingAccountCode() {
  return (
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.TBILL_TRADING_ACCOUNT)) ||
    DEFAULT_TBILL_TRADING_CODE
  );
}

async function getAccrualAssetAccountCode() {
  return (
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.TBILL_ACCRUAL_ASSET)) ||
    DEFAULT_TBILL_ACCRUAL_ASSET_CODE
  );
}

async function getAccrualIncomeAccountCode() {
  return (
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.TBILL_ACCRUAL_INCOME)) ||
    DEFAULT_TBILL_ACCRUAL_INCOME_CODE
  );
}

async function getInterestReceivedAccountCode() {
  return (
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.TBILL_INTEREST_RECEIVED)) ||
    DEFAULT_TBILL_INTEREST_RECEIVED_CODE
  );
}

async function getCapitalGainLossAccountCode() {
  return (
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.TBILL_CAPITAL_GAIN_LOSS)) ||
    DEFAULT_TBILL_CAPITAL_GAIN_LOSS_CODE
  );
}

/**
 * @param {object} transaction - tbill Buy row (snake_case)
 * @param {object} [options]
 * @param {string} [options.descriptionPrefix]
 * @param {string} [options.dealIdOverride]
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function postFinalApprovedBuyLedger(transaction, options = {}) {
  const prefix = options.descriptionPrefix || '';
  const dealId = options.dealIdOverride || transaction.deal_number;

  const amount = truncate8(Number(transaction.settlement_amount || 0));
  if (!(amount > 0)) {
    return { success: false, error: 'settlement_amount must be > 0 for T-Bill buy ledger posting' };
  }

  const tradingAccount = await getTradingAccountCode();
  const bankAccount = await resolveTbillBankCode(transaction.settlement_mode);
  const date = toYmd(transaction.value_date) || new Date().toISOString().slice(0, 10);

  if (options.dryRun) {
    return {
      success: true,
      dryRun: true,
      date,
      dr_lines: [{ account_code: tradingAccount, amount, description: `${prefix}T-Bill Purchase - Final Approval - ${transaction.deal_number}` }],
      cr_lines: [{ account_code: bankAccount, amount, description: `${prefix}T-Bill Purchase - Final Approval - ${transaction.deal_number}` }]
    };
  }

  const result = await ledgerController.postLedgerEntry({
    date,
    dr_account: tradingAccount,
    cr_account: bankAccount,
    amount,
    deal_id: dealId,
    description: `${prefix}T-Bill Purchase - Final Approval - ${transaction.deal_number}`
  });
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true };
}

/**
 * @param {object} transaction - tbill Sell row (snake_case); must include buy_deal_number, face_value, settlement_amount
 * @param {object} [options]
 * @param {string} [options.descriptionPrefix]
 * @param {string} [options.dealIdOverride]
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function postFinalApprovedSellLedger(transaction, options = {}) {
  const prefix = options.descriptionPrefix || '';
  const dealId = options.dealIdOverride || transaction.deal_number;

  const buyDealNumber = transaction.buy_deal_number;
  const buyDealId = options.buyDealId || transaction.buy_deal_id || null;

  let buyRows;
  if (buyDealNumber) {
    [buyRows] = await db.query(
      `SELECT * FROM tbill WHERE TRIM(deal_number) = ? AND transaction_type = 'Buy' LIMIT 1`,
      [String(buyDealNumber).trim()]
    );
  }
  if ((!buyRows || !buyRows.length) && buyDealId) {
    [buyRows] = await db.query(
      `SELECT * FROM tbill WHERE id = ? AND transaction_type = 'Buy' LIMIT 1`,
      [buyDealId]
    );
  }
  if (!buyRows || !buyRows.length) {
    const ref = buyDealNumber || buyDealId;
    return {
      success: false,
      error: ref
        ? `Buy deal not found for T-Bill sell: ${ref}`
        : 'Sell transaction is missing buy_deal_number; cannot post sell ledger'
    };
  }
  const buyDeal = buyRows[0];

  const soldFace = truncate8(Number(transaction.face_value || 0));
  const saleProceeds = truncate8(Number(transaction.settlement_amount || 0));
  const buyFace = Number(buyDeal.face_value || 0);
  const buySettlement = Number(buyDeal.settlement_amount || 0);
  const buyRemaining = Number(buyDeal.remaining_face_value || 0);
  const buyAccrued = Math.max(0, Number(buyDeal.accrued_interest_to_date || 0));

  if (!(soldFace > 0) || !(buyFace > 0)) {
    return { success: false, error: 'Invalid sold face value or buy deal face value for T-Bill sell ledger' };
  }

  // remaining_face_value on the buy row was already decremented for this sell at deal-creation time,
  // so add this sell's face back to recover the pre-sell remaining balance for the proportion calc.
  const remainingBeforeThisSell = buyRemaining + soldFace;
  const proportion = remainingBeforeThisSell > 0 ? soldFace / remainingBeforeThisSell : 0;

  const costBasis = truncate8((buySettlement / buyFace) * soldFace);
  const accrualReversal = truncate8(buyAccrued * proportion);
  const gainLoss = truncate8(saleProceeds - costBasis - accrualReversal);

  const tradingAccount = await getTradingAccountCode();
  const accrualAssetAccount = await getAccrualAssetAccountCode();
  const gainLossAccount = await getCapitalGainLossAccountCode();
  const bankAccount = await resolveTbillBankCode(transaction.settlement_mode || buyDeal.settlement_mode);

  const date = toYmd(transaction.value_date) || new Date().toISOString().slice(0, 10);
  const description = `${prefix}T-Bill Sale - Final Approval - ${transaction.deal_number}`;

  const drLines = [{ account_code: bankAccount, amount: saleProceeds, description }];
  const crLines = [];
  if (costBasis > 0) {
    crLines.push({ account_code: tradingAccount, amount: costBasis, description });
  }
  if (accrualReversal > 0) {
    crLines.push({ account_code: accrualAssetAccount, amount: accrualReversal, description });
  }
  if (gainLoss > 0) {
    crLines.push({ account_code: gainLossAccount, amount: gainLoss, description: `${description} (gain)` });
  } else if (gainLoss < 0) {
    drLines.push({ account_code: gainLossAccount, amount: Math.abs(gainLoss), description: `${description} (loss)` });
  }

  if (options.dryRun) {
    return {
      success: true,
      dryRun: true,
      date,
      dr_lines: drLines,
      cr_lines: crLines,
      computed: { soldFace, saleProceeds, costBasis, accrualReversal, gainLoss }
    };
  }

  const result = await ledgerController.postMultiLineLedgerEntry({
    date,
    dr_accounts: drLines,
    cr_accounts: crLines,
    deal_id: dealId,
    description
  });
  if (!result.success) {
    return { success: false, error: result.error };
  }

  if (accrualReversal > 0) {
    const newAccrued = Math.max(0, truncate8(buyAccrued - accrualReversal));
    await db.query('UPDATE tbill SET accrued_interest_to_date = ? WHERE id = ?', [newAccrued, buyDeal.id]);
  }

  return { success: true };
}

/** Daily discount accrual amount for the remaining face of a T-Bill Buy deal. */
function computeTbillDailyAccrual(deal) {
  const faceValue = Number(deal.face_value || 0);
  const settlementAmount = Number(deal.settlement_amount || 0);
  const daysToMaturity = Number(deal.days_to_maturity || 0);
  const remainingFace =
    deal.remaining_face_value !== null && deal.remaining_face_value !== undefined
      ? Number(deal.remaining_face_value)
      : faceValue;

  if (!(faceValue > 0) || !(daysToMaturity > 0) || !(remainingFace > 0)) {
    return { ok: false, reason: 'invalid face value, days to maturity, or remaining face value' };
  }
  const totalDiscount = faceValue - settlementAmount;
  if (!(totalDiscount > 0)) {
    return { ok: false, reason: 'no discount to accrue (settlement amount >= face value)' };
  }
  const dailyForOriginalFace = totalDiscount / daysToMaturity;
  const amount = truncate8(dailyForOriginalFace * (remainingFace / faceValue));
  if (!(amount > 0)) {
    return { ok: false, reason: 'computed accrual amount is zero' };
  }
  return { ok: true, amount };
}

async function hasTbillAccrualLedger(dealNumber, systemDay) {
  const [rows] = await db.query(
    `SELECT 1 FROM ledger_entries WHERE DATE(entry_date) = DATE(?) AND description = ? LIMIT 1`,
    [systemDay, `${ACCRUAL_DESCRIPTION_PREFIX} ${dealNumber}`]
  );
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * Post one day's discount accrual for a T-Bill Buy deal and update its running balances.
 * Idempotent per (deal_number, systemDay).
 * @param {object} deal - tbill Buy row
 * @param {string} systemDay - 'YYYY-MM-DD'
 * @returns {Promise<{success:boolean, posted:boolean, amount?:number, reason?:string, error?:string}>}
 */
async function postTbillDailyAccrual(deal, systemDay) {
  const computed = computeTbillDailyAccrual(deal);
  if (!computed.ok) {
    return { success: true, posted: false, reason: computed.reason };
  }

  if (await hasTbillAccrualLedger(deal.deal_number, systemDay)) {
    return { success: true, posted: false, skipped: 'already_posted' };
  }

  const accrualAssetAccount = await getAccrualAssetAccountCode();
  const accrualIncomeAccount = await getAccrualIncomeAccountCode();

  const result = await ledgerController.postLedgerEntry({
    date: systemDay,
    dr_account: accrualAssetAccount,
    cr_account: accrualIncomeAccount,
    amount: computed.amount,
    deal_id: deal.deal_number,
    description: `${ACCRUAL_DESCRIPTION_PREFIX} ${deal.deal_number}`
  });
  if (!result.success) {
    return { success: false, posted: false, error: result.error };
  }

  const newAccrued = truncate8(Number(deal.accrued_interest_to_date || 0) + computed.amount);
  await db.query('UPDATE tbill SET accrued_interest_to_date = ?, per_day_accrual = ? WHERE id = ?', [
    newAccrued,
    computed.amount,
    deal.id
  ]);

  return { success: true, posted: true, amount: computed.amount };
}

/** True if a maturity redemption entry already exists for this deal (idempotency guard). */
async function hasTbillMaturityLedger(dealNumber) {
  const [rows] = await db.query(
    `SELECT 1 FROM ledger_entries WHERE TRIM(deal_number) = ? AND description LIKE ? LIMIT 1`,
    [String(dealNumber).trim(), `${MATURITY_DESCRIPTION_PREFIX}%`]
  );
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * Post the maturity redemption journal for a T-Bill Buy deal and flag it matured.
 * Finance mapping (held to maturity): only Bank / Trading / Interest Receivable —
 * no TBILL_CAPITAL_GAIN_LOSS plug and no Accrual-Income ↔ Interest-Received reclass.
 * Idempotent: skips if a redemption entry already exists.
 * @param {object} buyRow - tbill Buy row
 * @param {object} [options]
 * @param {boolean} [options.markMatured=true]
 * @returns {Promise<{success:boolean, posted:boolean, skipped?:string, error?:string}>}
 */
async function postTbillMaturityLedger(buyRow, options = {}) {
  const markMatured = options.markMatured !== false;
  const dealNumber = buyRow.deal_number;

  if (await hasTbillMaturityLedger(dealNumber)) {
    if (markMatured) {
      await db.query('UPDATE tbill SET matured = 1 WHERE id = ?', [buyRow.id]);
    }
    return { success: true, posted: false, skipped: 'already_posted' };
  }

  const redeemFace = truncate8(Number(buyRow.remaining_face_value || 0));
  if (!(redeemFace > 0)) {
    return { success: false, posted: false, error: 'no remaining face value to redeem' };
  }

  const buyFace = Number(buyRow.face_value || 0);
  const buySettlement = Number(buyRow.settlement_amount || 0);
  let costBasisRemaining = buyFace > 0 ? truncate8((buySettlement / buyFace) * redeemFace) : 0;
  // Cap cost at face so the three-line entry can always balance without a P&L plug.
  if (costBasisRemaining > redeemFace) costBasisRemaining = redeemFace;
  const receivableClear = truncate8(redeemFace - costBasisRemaining);

  const tradingAccount = await getTradingAccountCode();
  const accrualAssetAccount = await getAccrualAssetAccountCode();
  const bankAccount = await resolveTbillBankCode(buyRow.settlement_mode);

  const maturityDate = toYmd(buyRow.maturity_date) || new Date().toISOString().slice(0, 10);
  const redemptionDescription = `${MATURITY_DESCRIPTION_PREFIX} ${dealNumber}`;

  const drLines = [{ account_code: bankAccount, amount: redeemFace, description: redemptionDescription }];
  const crLines = [];
  if (costBasisRemaining > 0) {
    crLines.push({ account_code: tradingAccount, amount: costBasisRemaining, description: redemptionDescription });
  }
  if (receivableClear > 0) {
    crLines.push({ account_code: accrualAssetAccount, amount: receivableClear, description: redemptionDescription });
  }

  const redemptionResult = await ledgerController.postMultiLineLedgerEntry({
    date: maturityDate,
    dr_accounts: drLines,
    cr_accounts: crLines,
    deal_id: dealNumber,
    description: redemptionDescription
  });
  if (!redemptionResult.success) {
    return { success: false, posted: false, error: redemptionResult.error };
  }

  const matureSql = markMatured
    ? 'UPDATE tbill SET accrued_interest_to_date = 0, per_day_accrual = 0, matured = 1 WHERE id = ?'
    : 'UPDATE tbill SET accrued_interest_to_date = 0, per_day_accrual = 0 WHERE id = ?';
  await db.query(matureSql, [buyRow.id]);

  return { success: true, posted: true };
}

module.exports = {
  ACCRUAL_DESCRIPTION_PREFIX,
  MATURITY_DESCRIPTION_PREFIX,
  MATURITY_INCOME_DESCRIPTION_PREFIX,
  truncate8,
  resolveTbillBankCode,
  postFinalApprovedBuyLedger,
  postFinalApprovedSellLedger,
  computeTbillDailyAccrual,
  hasTbillAccrualLedger,
  postTbillDailyAccrual,
  hasTbillMaturityLedger,
  postTbillMaturityLedger
};
