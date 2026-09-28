const pool = require('../config/database');
const counterpartyModel = require('../models/counterpartyModel');
const User = require('../models/userModel');

function buildCounterpartyLookup(rows) {
  const byKey = new Map();
  const numericMaps = {
    corporate: new Map(),
    individual: new Map(),
    joint: new Map()
  };

  for (const cp of rows) {
    const shortName = cp.short_name || cp.long_name;
    if (!shortName) continue;

    byKey.set(String(cp.unique_id), shortName);
    byKey.set(String(cp.unique_id).toLowerCase(), shortName);

    const prefix = cp.type === 'corporate' ? 'c' : cp.type === 'individual' ? 'i' : 'j';
    byKey.set(`${prefix}${cp.original_id}`, shortName);

    numericMaps[cp.type].set(Number(cp.original_id), shortName);
  }

  return { byKey, numericMaps };
}

function resolveCounterpartyName(raw, lookup) {
  if (raw === null || raw === undefined || raw === '') return null;
  const key = String(raw).trim();
  if (!key) return null;

  if (lookup.byKey.has(key)) return lookup.byKey.get(key);
  const lower = key.toLowerCase();
  if (lookup.byKey.has(lower)) return lookup.byKey.get(lower);

  if (/^\d+$/.test(key)) {
    const n = Number(key);
    return lookup.numericMaps.corporate.get(n)
      || lookup.numericMaps.individual.get(n)
      || lookup.numericMaps.joint.get(n)
      || key;
  }

  return key;
}

function buildUserLookup(rows) {
  const byId = new Map();
  const byUsername = new Map();
  for (const u of rows) {
    if (u.id != null) {
      byId.set(Number(u.id), u.username);
    }
    if (u.username) {
      byUsername.set(String(u.username).toLowerCase(), u.username);
    }
  }
  return { byId, byUsername };
}

function resolveEnteredBy(raw, lookup) {
  if (raw === null || raw === undefined || raw === '') return null;
  const key = String(raw).trim();
  if (!key) return null;
  const asNum = Number(key);
  if (Number.isFinite(asNum) && asNum > 0 && lookup.byId.has(asNum)) {
    return lookup.byId.get(asNum);
  }
  const byName = lookup.byUsername.get(key.toLowerCase());
  if (byName) return byName;
  return key;
}

function normalizeKey(value) {
  return (value || '').toString().trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function prettyApprovalLevel(level) {
  const key = normalizeKey(level);
  if (key === 'back_office_final') return 'Back Office Final';
  if (key === 'back_office_verifier') return 'Back Office Verifier';
  if (key === 'front_office' || key === 'front_office_verifier') return 'Front Office';
  if (key === 'final_approved') return 'Final Approved';
  return level || null;
}

// Normalizes the many inconsistent status/approval-level spellings used across
// deal tables (see CLAUDE.md note on raw-SQL, per-table workflow columns) into
// a single display bucket for the combined blotter.
function normalizeStatus(rawStatus, approvalLevel) {
  const status = normalizeKey(rawStatus);
  const level = normalizeKey(approvalLevel);

  if (['rejected', 'returned', 'cancelled'].includes(status)) return 'Rejected';
  if (status === 'draft') return 'Draft';
  if (['approved', 'final_approved', 'settled', 'matured', 'active'].includes(status)) return 'Approved';

  if (status === 'pending' || status === 'pending_verification' || status === 'verified' || status === 'pending_final_approval') {
    if (level === 'back_office_final' || status === 'pending_final_approval') return 'Pending Final Approval';
    if (level === 'back_office_verifier' || status === 'verified') return 'Pending Back Office Verification';
    return 'Pending Front Office';
  }

  return rawStatus || 'Unknown';
}

/** Workflow stop for Daily Transaction Blotter — not a flattened Approved. */
function normalizeWorkflowStop(rawStatus, approvalLevel) {
  const status = normalizeKey(rawStatus);
  const level = normalizeKey(approvalLevel);

  if (['rejected', 'returned', 'cancelled'].includes(status)) return 'Rejected';
  if (status === 'draft') return 'Draft';
  if (status === 'final_approved' || level === 'final_approved') return 'Final Approved';
  if (['approved', 'settled', 'matured', 'active'].includes(status)) return 'Approved';

  if (
    status === 'pending' ||
    status === 'pending_verification' ||
    status === 'verified' ||
    status === 'pending_final_approval' ||
    !status
  ) {
    if (level === 'back_office_final' || status === 'pending_final_approval') return 'Pending Final Approval';
    if (level === 'back_office_verifier' || status === 'verified' || status === 'pending_verification') {
      return 'Pending Back Office Verification';
    }
    return 'Pending Front Office';
  }

  if (level === 'front_office' || level === 'front_office_verifier') return 'Pending Front Office';
  if (level === 'back_office_verifier') return 'Pending Back Office Verification';
  if (level === 'back_office_final') return 'Pending Final Approval';

  return rawStatus || 'Unknown';
}

function mapRow(dealType, row, options = {}) {
  const workflowStop = Boolean(options.workflowStop);
  const status = workflowStop
    ? normalizeWorkflowStop(row.status, row.approval_level)
    : normalizeStatus(row.status, row.approval_level);
  const levelLabel = prettyApprovalLevel(row.approval_level);
  const pending = String(status).startsWith('Pending');
  return {
    dealType,
    dealNumber: row.deal_number,
    dealDate: row.deal_date,
    valueDate: row.value_date,
    counterparty: row.counterparty,
    instrument: row.instrument,
    amount: row.amount !== undefined && row.amount !== null ? Number(row.amount) : null,
    rate: row.rate !== undefined && row.rate !== null ? Number(row.rate) : null,
    rawStatus: row.status,
    approvalLevel: row.approval_level,
    status,
    statusDetail: pending && levelLabel ? `Pending — ${levelLabel}` : status,
    enteredBy: row.entered_by,
    frontOfficeBy: row.front_office_by ?? null,
    backOfficeVerifierBy: row.back_office_verifier_by ?? null,
    finalApprovedBy: row.final_approved_by ?? null
  };
}

async function safeQuery(dealType, sql, params, mapOptions = {}) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows.map((row) => mapRow(dealType, row, mapOptions));
  } catch (error) {
    console.error(`[dailyDealBlotter] Failed to fetch ${dealType} deals:`, error.message);
    return [];
  }
}

const DATE_MODE = {
  TRADE: 'trade',
  VALUE: 'value'
};

async function getTransactions(date, mode, mapOptions) {
  const where = mode === DATE_MODE.VALUE
    ? 'WHERE DATE(t.value_date) = ?'
    : 'WHERE DATE(COALESCE(t.trade_date, t.date)) = ?';
  return safeQuery('TRANSACTION', `
    SELECT
      t.transaction_code AS deal_number,
      COALESCE(t.trade_date, t.date) AS deal_date,
      t.value_date AS value_date,
      t.counterparty_id AS counterparty,
      t.security_id AS instrument,
      t.amount AS amount,
      t.interest_rate AS rate,
      t.status AS status,
      t.current_approval_level AS approval_level,
      COALESCE(NULLIF(t.submitted_by, 0), NULLIF(t.user, 0)) AS entered_by
    FROM transactions t
    ${where}
  `, [date], mapOptions);
}

async function getMoneyMarketDeals(date, mode, mapOptions) {
  const where = mode === DATE_MODE.VALUE
    ? 'WHERE DATE(mm.value_date) = ?'
    : 'WHERE DATE(mm.trade_date) = ?';
  return safeQuery('MONEY_MARKET', `
    SELECT
      mm.deal_number AS deal_number,
      mm.trade_date AS deal_date,
      mm.value_date AS value_date,
      mm.counterparty_id AS counterparty,
      mm.product_type AS instrument,
      mm.principal_amount AS amount,
      mm.interest_rate AS rate,
      mm.status AS status,
      NULL AS approval_level,
      NULL AS entered_by
    FROM money_market_deals mm
    ${where}
  `, [date], mapOptions);
}

async function getGsecDeals(date, mode, mapOptions) {
  const Gsec = require('../models/gsec');
  if (typeof Gsec.ensureColumns === 'function') {
    await Gsec.ensureColumns();
  }
  // A buyback's far leg (leg 2) is the maturity/repurchase - it belongs on maturity
  // cashflow, not on the blotter, where only the day's actual dealing (leg 1) belongs.
  //
  // This used to exclude every buyback-linked GSec *Buy*, which only works for Sell/Buy
  // buybacks. On a Buy/Sell buyback the legs are the other way round, so it hid leg 1
  // (the real dealing) and showed leg 2 (a future leg) - exactly backwards. Match the
  // buyback's own leg 2 transaction type instead, which is correct for both products.
  // Verified across the book: leg 1 and leg 2 never share a transaction type.
  const buybackFarLeg = `
    AND NOT EXISTS (
      SELECT 1 FROM buyback_deals bd
       WHERE bd.id = g.buyback_deal_id
         AND LOWER(COALESCE(g.transaction_type, '')) = LOWER(COALESCE(bd.leg2_transaction_type, ''))
    )`;
  // Daily Deal Blotter: drop every buyback-generated GSec leg. The buyback itself is
  // already listed as its own BUYBACK row, and these leg rows are bookings the buyback
  // creates (leg 1 so settlement letters work, leg 2 for the repurchase) - listing them
  // too showed each buyback twice and double-counted the day's dealing.
  const buybackAnyLeg = 'AND g.buyback_deal_id IS NULL';
  const where = mode === DATE_MODE.VALUE
    ? `WHERE DATE(g.value_date) = ? ${buybackFarLeg}`
    : `WHERE DATE(g.trade_date) = ? ${buybackAnyLeg}`;
  return safeQuery('GSEC', `
    SELECT
      g.deal_number AS deal_number,
      g.trade_date AS deal_date,
      g.value_date AS value_date,
      g.counterparty_id AS counterparty,
      g.isin_number AS instrument,
      g.face_value AS amount,
      g.yield AS rate,
      g.status AS status,
      g.current_approval_level AS approval_level,
      u.username AS entered_by,
      fo.username AS front_office_by,
      bov.username AS back_office_verifier_by,
      fin.username AS final_approved_by
    FROM gsec g
    LEFT JOIN users u ON u.id = g.created_by
    LEFT JOIN users fo ON fo.id = g.front_office_by
    LEFT JOIN users bov ON bov.id = g.back_office_verifier_by
    LEFT JOIN users fin ON fin.id = g.final_approved_by
    ${where}
  `, [date], mapOptions);
}

async function getTbillDeals(date, mode, mapOptions) {
  const where = mode === DATE_MODE.VALUE
    ? 'WHERE DATE(tb.value_date) = ?'
    : 'WHERE DATE(tb.trade_date) = ?';
  return safeQuery('TBILL', `
    SELECT
      tb.deal_number AS deal_number,
      tb.trade_date AS deal_date,
      tb.value_date AS value_date,
      tb.counterparty AS counterparty,
      tb.isin_number AS instrument,
      tb.face_value AS amount,
      tb.discount_rate_pct AS rate,
      tb.status AS status,
      tb.current_approval_level AS approval_level,
      u.username AS entered_by
    FROM tbill tb
    LEFT JOIN users u ON u.id = tb.user_id
    ${where}
  `, [date], mapOptions);
}

async function getBuybackDeals(date, mode, mapOptions) {
  const BuybackDeal = require('../models/buybackDealModel');
  if (typeof BuybackDeal.ensureApprovalColumns === 'function') {
    try {
      await BuybackDeal.ensureApprovalColumns();
    } catch (ensureErr) {
      console.error('[dailyDealBlotter] Failed to ensure buyback approval columns:', ensureErr.message);
    }
  }
  // Daily transactions: opening (leg1) only. Sell/Buy Buy (leg2) is a maturity.
  const where = mode === DATE_MODE.VALUE
    ? 'WHERE DATE(b.leg1_value_date) = ?'
    : 'WHERE DATE(b.leg1_trade_date) = ? OR DATE(b.leg2_trade_date) = ?';
  const params = mode === DATE_MODE.VALUE ? [date] : [date, date];
  return safeQuery('BUYBACK', `
    SELECT
      b.deal_number AS deal_number,
      COALESCE(b.leg1_trade_date, b.leg2_trade_date) AS deal_date,
      b.leg1_value_date AS value_date,
      b.leg1_counterparty AS counterparty,
      b.leg1_isin AS instrument,
      b.leg1_face_value AS amount,
      b.leg1_yield_rate AS rate,
      b.deal_status AS status,
      NULL AS approval_level,
      u.username AS entered_by,
      fo.username AS front_office_by,
      bov.username AS back_office_verifier_by,
      fin.username AS final_approved_by
    FROM buyback_deals b
    LEFT JOIN users u ON u.id = b.created_by
    LEFT JOIN users fo ON fo.id = b.front_office_by
    LEFT JOIN users bov ON bov.id = b.back_office_verifier_by
    LEFT JOIN users fin ON fin.id = b.final_approved_by
    ${where}
  `, params, mapOptions);
}

async function getFixedDepositDeals(date, mode, mapOptions) {
  const where = mode === DATE_MODE.VALUE
    ? 'WHERE DATE(fd.value_date) = ?'
    : 'WHERE DATE(COALESCE(fd.submitted_at, fd.created_at)) = ?';
  return safeQuery('FIXED_DEPOSIT', `
    SELECT
      fd.request_no AS deal_number,
      COALESCE(fd.submitted_at, fd.created_at) AS deal_date,
      fd.value_date AS value_date,
      fd.counterparty_id AS counterparty,
      fd.isin AS instrument,
      fd.requested_amount AS amount,
      fd.target_yield AS rate,
      fd.status AS status,
      NULL AS approval_level,
      u.username AS entered_by
    FROM fixed_deposit_requests fd
    LEFT JOIN users u ON u.id = fd.submitted_by
    ${where}
  `, [date], mapOptions);
}

async function getRepoDeals(date, mode, mapOptions) {
  const RepoDeal = require('../models/repoDealModel');
  if (typeof RepoDeal.ensureApprovalColumns === 'function') {
    try {
      await RepoDeal.ensureApprovalColumns();
    } catch (ensureErr) {
      console.error('[dailyDealBlotter] Failed to ensure repo approval columns:', ensureErr.message);
    }
  }
  const where = mode === DATE_MODE.VALUE
    ? 'WHERE DATE(r.value_date) = ?'
    : 'WHERE DATE(r.trade_date) = ?';
  return safeQuery('REPO', `
    SELECT
      COALESCE(NULLIF(TRIM(r.deal_number), ''), CONCAT('REPO-', r.id)) AS deal_number,
      r.trade_date AS deal_date,
      r.value_date AS value_date,
      r.counterparty_id AS counterparty,
      r.isin_number AS instrument,
      COALESCE(r.principal_amount, r.face_value) AS amount,
      r.rate AS rate,
      COALESCE(r.approval_status, r.status) AS status,
      r.current_approval_level AS approval_level,
      u.username AS entered_by,
      fo.username AS front_office_by,
      bov.username AS back_office_verifier_by,
      fin.username AS final_approved_by
    FROM repo_deals r
    LEFT JOIN users u ON u.id = r.created_by
    LEFT JOIN users fo ON fo.id = r.front_office_by
    LEFT JOIN users bov ON bov.id = r.back_office_verifier_by
    LEFT JOIN users fin ON fin.id = r.final_approved_by
    ${where}
  `, [date], mapOptions);
}

async function assembleBlotter(date, mode, mapOptions = {}, sortBy = 'dealDate') {
  const [cpLookup, users] = await Promise.all([
    counterpartyModel.getAll().then(buildCounterpartyLookup),
    User.getAll()
  ]);
  const userLookup = buildUserLookup(users);

  const results = await Promise.all([
    getTransactions(date, mode, mapOptions),
    getMoneyMarketDeals(date, mode, mapOptions),
    getGsecDeals(date, mode, mapOptions),
    getTbillDeals(date, mode, mapOptions),
    getBuybackDeals(date, mode, mapOptions),
    getFixedDepositDeals(date, mode, mapOptions),
    getRepoDeals(date, mode, mapOptions)
  ]);

  const deals = results.flat().map((deal) => ({
    ...deal,
    counterparty: resolveCounterpartyName(deal.counterparty, cpLookup) || deal.counterparty,
    enteredBy: resolveEnteredBy(deal.enteredBy, userLookup) || deal.enteredBy || null,
    frontOfficeBy: resolveEnteredBy(deal.frontOfficeBy, userLookup) || deal.frontOfficeBy || null,
    backOfficeVerifierBy: resolveEnteredBy(deal.backOfficeVerifierBy, userLookup) || deal.backOfficeVerifierBy || null,
    finalApprovedBy: resolveEnteredBy(deal.finalApprovedBy, userLookup) || deal.finalApprovedBy || null
  }));
  deals.sort((a, b) => {
    const primary = sortBy === 'valueDate'
      ? new Date(a.valueDate || 0) - new Date(b.valueDate || 0)
      : new Date(a.dealDate || 0) - new Date(b.dealDate || 0);
    if (primary !== 0) return primary;
    return String(a.dealType || '').localeCompare(String(b.dealType || ''));
  });

  const summary = deals.reduce((acc, deal) => {
    acc.totalDeals += 1;
    acc.byDealType[deal.dealType] = (acc.byDealType[deal.dealType] || 0) + 1;
    acc.byStatus[deal.status] = (acc.byStatus[deal.status] || 0) + 1;
    return acc;
  }, { totalDeals: 0, byDealType: {}, byStatus: {} });

  return { deals, summary };
}

async function getDailyDealBlotter(date) {
  return assembleBlotter(date, DATE_MODE.TRADE);
}

async function getDailyTransactionBlotter(date) {
  return assembleBlotter(date, DATE_MODE.VALUE, { workflowStop: true }, 'valueDate');
}

module.exports = { getDailyDealBlotter, getDailyTransactionBlotter };
