/**
 * GSEC outright-purchase MATURITY (redemption) ledger posting.
 *
 * At maturity a GSEC Buy holding redeems at par. The redemption journal recognises
 * the original clean cost out of the trading asset and books the remaining
 * discount (or premium) against the amortised discount/premium account:
 *
 *   Discount bond (clean <= 100):
 *     DR  Bank (settlement a/c)                  = remaining face (par)
 *     CR  Treasury Bonds - Trading               = remaining face x clean / 100
 *     CR  Amortised Discount Received - Trading   = remaining face - clean cost
 *
 *   Premium bond (clean > 100):
 *     DR  Bank (settlement a/c)                  = remaining face (par)
 *     DR  Amortised Premium Paid - Trading       = clean cost - remaining face
 *     CR  Treasury Bonds - Trading               = remaining face x clean / 100
 *
 * Shared by the EOD auto-post block, the manual backfill script, and the dry-run
 * preview so all three produce an identical, balanced entry.
 */
const db = require('../config/database');
const accountMapping = require('./accountMappingService');
const ledgerController = require('../controllers/ledgerController');

const DEFAULT_GSEC_BANK_LEDGER_CODE = '131-101-410-164-44';
const MATURITY_DESCRIPTION_PREFIX = 'GSec Maturity - Redemption -';

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

function rowRemainingFace(row) {
  const face = Number(row.face_value || 0);
  const rem = row.remaining_face_value;
  if (rem === null || rem === undefined || rem === '') return face;
  const n = Number(rem);
  return Number.isFinite(n) ? n : face;
}

/**
 * Sum the redemption components across all Buy allocation rows of one deal.
 * Each row contributes its own clean price so deals with differently-priced
 * allocations are handled correctly.
 * @param {Array<object>} rows - gsec Buy rows sharing one deal_number
 */
function computeMaturityComponents(rows) {
  let redeemFace = 0;
  let cleanAmt = 0;
  for (const row of rows) {
    const rem = rowRemainingFace(row);
    if (!(rem > 0)) continue;
    const cleanPrice = Number(row.clean_price || 0);
    redeemFace = truncate8(redeemFace + rem);
    cleanAmt = truncate8(cleanAmt + (rem * cleanPrice) / 100);
  }
  const discount = truncate8(redeemFace - cleanAmt); // > 0 discount (CR), < 0 premium (DR)
  return { redeemFace, cleanAmt, discount, isPremium: discount < 0 };
}

/** DR bank: settlement_accounts by settlement_mode, else GSEC_DEFAULT_SETTLEMENT mapping, else hard default. */
async function resolveMaturityBankCode(settlementMode) {
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
      console.warn('GSec maturity settlement_accounts lookup failed:', e.message);
    }
  }
  const mapped = await accountMapping.getAccountCodeOptional(
    accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT
  );
  return mapped || DEFAULT_GSEC_BANK_LEDGER_CODE;
}

/**
 * Build the balanced maturity journal (lines + metadata) for one deal's Buy rows.
 * Does NOT write anything.
 * @param {Array<object>} rows - gsec Buy rows sharing one deal_number
 * @returns {Promise<object>} journal description
 */
async function buildGsecMaturityJournal(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('buildGsecMaturityJournal requires at least one Buy row');
  }
  const head = rows[0];
  const dealNumber = head.deal_number;
  const comp = computeMaturityComponents(rows);

  const bankCode = await resolveMaturityBankCode(head.settlement_mode);
  const tradingCode =
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_TRADING_ACCOUNT)) ||
    '131-101-350-098-44';
  // Maturity clears the balance-sheet amortisation GL (134), not the daily P&L key (416).
  const amortCode =
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_FINANCIAL_ASSETS_AMORTISED_COST)) ||
    '131-101-350-134-44';

  const maturityDate = toYmd(head.maturity_date) || new Date().toISOString().slice(0, 10);
  const description = `${MATURITY_DESCRIPTION_PREFIX} ${dealNumber}`;

  const drLines = [{ account_code: bankCode, amount: comp.redeemFace, description }];
  const crLines = [];
  if (comp.cleanAmt > 0) {
    crLines.push({ account_code: tradingCode, amount: comp.cleanAmt, description });
  }
  if (Math.abs(comp.discount) > 0.00000001) {
    if (comp.isPremium) {
      drLines.push({ account_code: amortCode, amount: Math.abs(comp.discount), description });
    } else {
      crLines.push({ account_code: amortCode, amount: Math.abs(comp.discount), description });
    }
  }

  return {
    dealNumber,
    maturityDate,
    description,
    bankCode,
    tradingCode,
    amortCode,
    drLines,
    crLines,
    ...comp
  };
}

/** True if a maturity redemption entry already exists for this deal (idempotency guard). */
async function hasMaturityLedger(dealNumber) {
  const [rows] = await db.query(
    `SELECT 1 FROM ledger_entries
     WHERE TRIM(deal_number) = ?
       AND description LIKE 'GSec Maturity - Redemption -%'
     LIMIT 1`,
    [String(dealNumber).trim()]
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** Load all final-approved Buy allocation rows for a deal number. */
async function getBuyRowsForDeal(dealNumber) {
  const [rows] = await db.query(
    `SELECT id, deal_number, transaction_type, isin_number, face_value,
            remaining_face_value, clean_price, dirty_price, value_date,
            maturity_date, settlement_mode, settlement_amount,
            COALESCE(matured, 0) AS matured, status
     FROM gsec
     WHERE transaction_type = 'Buy' AND TRIM(deal_number) = ?
     ORDER BY id`,
    [String(dealNumber).trim()]
  );
  return rows || [];
}

/**
 * Post the maturity redemption journal for one deal (all its Buy rows) and flag
 * the rows matured. Idempotent: skips if an entry already exists.
 *
 * @param {Array<object>} rows - gsec Buy rows sharing one deal_number
 * @param {object} [options]
 * @param {boolean} [options.markMatured=true] - set gsec.matured = 1 after posting
 * @returns {Promise<{success:boolean, posted:boolean, skipped?:string, error?:string, journal?:object}>}
 */
async function postGsecMaturityLedger(rows, options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { success: false, posted: false, error: 'no Buy rows supplied' };
  }
  const markMatured = options.markMatured !== false;
  const dealNumber = rows[0].deal_number;

  if (await hasMaturityLedger(dealNumber)) {
    if (markMatured) {
      await db.query(
        "UPDATE gsec SET matured = 1 WHERE transaction_type = 'Buy' AND TRIM(deal_number) = ?",
        [String(dealNumber).trim()]
      );
    }
    return { success: true, posted: false, skipped: 'already_posted' };
  }

  const journal = await buildGsecMaturityJournal(rows);
  if (!(journal.redeemFace > 0)) {
    return { success: false, posted: false, error: 'no remaining face value to redeem', journal };
  }

  const result = await ledgerController.postMultiLineLedgerEntry({
    date: journal.maturityDate,
    dr_accounts: journal.drLines,
    cr_accounts: journal.crLines,
    deal_id: dealNumber,
    description: journal.description
  });
  if (!result.success) {
    return { success: false, posted: false, error: result.error, journal };
  }

  if (markMatured) {
    await db.query(
      "UPDATE gsec SET matured = 1 WHERE transaction_type = 'Buy' AND TRIM(deal_number) = ?",
      [String(dealNumber).trim()]
    );
  }
  return { success: true, posted: true, journal };
}

module.exports = {
  MATURITY_DESCRIPTION_PREFIX,
  truncate8,
  computeMaturityComponents,
  resolveMaturityBankCode,
  buildGsecMaturityJournal,
  hasMaturityLedger,
  getBuyRowsForDeal,
  postGsecMaturityLedger
};
