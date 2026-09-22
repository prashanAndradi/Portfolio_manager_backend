const db = require('../config/db');
const { differenceInDays, parseISO } = require('date-fns');
const { calculateNVP } = require('../utils/bondPricingNVP');
const {
  getCouponPeriodLengthDaysFromIsinSchedule,
  resolveIsinCouponDates,
  computeGsecPerDayAccrual
} = require('./gsecCouponPeriod');
const { buildSoldByDealMap } = require('./gsecSellDeductionService');
const { isTransactionsView, resolveTransactionDateRange, pushValueDateRange } = require('./reportViewHelper');

// Helper to truncate to 4 decimals
function truncate4(val) {
  return Math.floor(Number(val) * 10000) / 10000;
}

// Number formatting functions for better display
function formatCurrency(value, decimals = 2) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (isNaN(num)) return '';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatPrice(value, decimals = 4) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (isNaN(num)) return '';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatPercentage(value, decimals = 4) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (isNaN(num)) return '';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function utcDayDiffSigned(a, b) {
  const da = new Date(a);
  const dbb = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(dbb.getTime())) return 0;
  const aUtc = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const bUtc = Date.UTC(dbb.getFullYear(), dbb.getMonth(), dbb.getDate());
  return (aUtc - bUtc) / (24 * 60 * 60 * 1000);
}

function clampToYmd(x) {
  const d = new Date(x);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function truncate8(x) {
  return Math.floor(Number(x) * 100000000) / 100000000;
}

/** Stored gsec.remaining_face_value when set on the buy row (source of truth for outstanding). */
function parseStoredRemainingFaceValue(row) {
  const raw = row.remaining_face_value;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}

/**
 * Compute remaining face freshly from face_value - linked sells - linked buybacks.
 * We deliberately do NOT rely on the stored gsec.remaining_face_value column because
 * historical drift in that column can hide deals that should still be visible.
 */
function resolveEffectiveRemainingFace(row) {
  const face = Math.max(0, Number(row.face_value) || 0);
  const directSold = Number(row._direct_sold_against_deal ?? 0);
  const directBuyback = Number(row._direct_buyback_against_deal ?? 0);
  if (directSold <= 0 && directBuyback <= 0) {
    return face;
  }
  return Math.max(0, Number(row.remaining_face_value_report ?? face) || 0);
}

const BUYBACK_LETTER_SKIP_SQL = `NOT (
          g.buyback_deal_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM buyback_deals bd_letter
            WHERE bd_letter.id = g.buyback_deal_id
              AND bd_letter.leg1_transaction_type = 'Buy'
              AND bd_letter.leg2_transaction_type = 'Sell'
          )
        )`;

async function getGsecTransactionsReport({ asAtDate, portfolio, isin, valueDate, maturityDate, dateFrom, dateTo, page, pageSize }) {
  const range = resolveTransactionDateRange({ dateFrom, dateTo, asAtDate, valueDate });
  const whereParts = [
    `g.transaction_type IN ('Buy', 'Sell')`,
    `COALESCE(g.status, '') NOT IN ('cancelled', 'rejected')`,
    BUYBACK_LETTER_SKIP_SQL
  ];
  const params = [];

  if (portfolio) {
    whereParts.push('g.portfolio = ?');
    params.push(portfolio);
  }
  if (isin) {
    whereParts.push('g.isin_number = ?');
    params.push(isin);
  }
  pushValueDateRange(whereParts, params, 'g.value_date', range);
  if (maturityDate) {
    whereParts.push('DATE(g.maturity_date) = DATE(?)');
    params.push(maturityDate);
  }

  const whereSql = `WHERE ${whereParts.join(' AND ')}`;
  const fromSql = `
      FROM gsec g
      LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
      LEFT JOIN counterparty_master_corporate corp ON (g.counterparty_id LIKE 'c%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = corp.id) OR (g.counterparty_id = corp.id)
      LEFT JOIN counterparty_master_individual ind ON (g.counterparty_id LIKE 'i%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = ind.id) OR (g.counterparty_id = ind.id)
      LEFT JOIN counterparty_master_joint joint ON (g.counterparty_id LIKE 'j%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = joint.id) OR (g.counterparty_id = joint.id)
      ${whereSql}`;

  const countSql = `SELECT COUNT(*) AS count ${fromSql}`;
  const [[{ count }]] = await db.query(countSql, params);

  let selectSql = `
      SELECT g.id, g.portfolio, g.deal_number, g.face_value, g.trade_date, g.value_date, g.maturity_date,
             g.isin_number AS isin, g.coupon_interest, g.clean_price, g.dirty_price, g.yield,
             g.settlement_amount, g.status, g.counterparty_id, g.transaction_type,
             COALESCE(
               corp.short_name,
               ind.short_name,
               joint.short_name,
               CONCAT('ID:', g.counterparty_id)
             ) AS counterparty_name,
             im.coupon_rate, im.issue_date
      ${fromSql}
      ORDER BY g.value_date DESC, g.id DESC`;
  const selectParams = [...params];
  if (page && pageSize) {
    const limit = Number(pageSize);
    const offset = (Number(page) - 1) * Number(pageSize);
    selectSql += ' LIMIT ? OFFSET ?';
    selectParams.push(limit, offset);
  }

  const [rows] = await db.query(selectSql, selectParams);
  const data = rows.map((row) => ({
    id: row.id,
    product_type: 'GSec',
    portfolio: row.portfolio,
    custodian: '',
    deal_number: row.deal_number || '',
    transaction_type: row.transaction_type || '',
    trade_date: row.trade_date,
    value_date: row.value_date,
    maturity_date: row.maturity_date,
    issue_date: row.issue_date || null,
    isin: row.isin,
    face_value: formatCurrency(row.face_value, 2),
    coupon_rate: formatPercentage(row.coupon_rate, 4),
    coupon_interest: formatPrice(periodCouponOnFace(row.face_value, row.coupon_rate, row.coupon_interest, row.face_value), 4),
    clean_price: formatPrice(row.clean_price, 4),
    dirty_price: formatPrice(row.dirty_price, 4),
    yield: formatPercentage(row.yield, 4),
    settlement_amount: formatCurrency(row.settlement_amount, 2),
    counterparty: row.counterparty_name || (row.counterparty_id ? String(row.counterparty_id) : ''),
    status: row.status || ''
  }));

  return { data, total: Number(count) || 0, totalPortfolioBalance: null, summary: [] };
}

// One coupon period's interest (semi-annual) on `face`, from the ISIN coupon rate.
// gsec.coupon_interest is fixed at deal entry on the original face - and some rows
// hold the annual figure - so it is only a fallback when the rate is unknown.
function periodCouponOnFace(face, couponRate, storedCouponInterest, storedFace) {
  const faceNum = Number(face) || 0;
  const rate = Number(couponRate);
  if (Number.isFinite(rate) && rate > 0) return (faceNum * rate) / 100 / 2;
  const stored = Number(storedCouponInterest) || 0;
  const base = Number(storedFace) || 0;
  return base > 0 ? stored * (faceNum / base) : stored;
}

exports.getGsecReport = async ({ asAtDate, portfolio, isin, valueDate, maturityDate, dateFrom, dateTo, page, pageSize, view }) => {
  try {
    if (isTransactionsView(view)) {
      return getGsecTransactionsReport({ asAtDate, portfolio, isin, valueDate, maturityDate, dateFrom, dateTo, page, pageSize });
    }

    // Debug: Log the asAtDate parameter
    console.log(`[GSEC Report] Called with asAtDate: ${asAtDate}, portfolio: ${portfolio}, isin: ${isin}`);
    
    // Build query with filters - only include Buy transactions from GSEC deals
    let sql = `SELECT g.id, g.portfolio, g.deal_number, g.face_value, g.remaining_face_value, g.matured, g.value_date, g.maturity_date, g.isin_number as isin, g.coupon_interest, g.clean_price, g.dirty_price, g.yield, g.counterparty_id, g.transaction_type,
               g.per_day_accrual AS daily_accrual,
               g.per_day_amortization AS daily_amortization,
               COALESCE(
                 corp.short_name,
                 ind.short_name,
                 joint.short_name,
                 CONCAT('ID:', g.counterparty_id)
               ) AS counterparty_name,
               im.coupon_rate, im.issue_date, im.coupon_date_1, im.coupon_date_2
      FROM gsec g 
      LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
      LEFT JOIN counterparty_master_corporate corp ON (g.counterparty_id LIKE 'c%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = corp.id) OR (g.counterparty_id = corp.id)
      LEFT JOIN counterparty_master_individual ind ON (g.counterparty_id LIKE 'i%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = ind.id) OR (g.counterparty_id = ind.id)
      LEFT JOIN counterparty_master_joint joint ON (g.counterparty_id LIKE 'j%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = joint.id) OR (g.counterparty_id = joint.id)
      WHERE g.transaction_type = 'Buy'
        AND COALESCE(g.status, '') NOT IN ('cancelled', 'rejected')
        AND NOT (
          g.buyback_deal_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM buyback_deals bd_letter
            WHERE bd_letter.id = g.buyback_deal_id
              AND bd_letter.leg1_transaction_type = 'Buy'
              AND bd_letter.leg2_transaction_type = 'Sell'
          )
        )`;
    const params = [];
    
    // Add GSEC filters
    if (portfolio) {
      sql += ' AND g.portfolio = ?';
      params.push(portfolio);
    }
    if (isin) {
      sql += ' AND g.isin_number = ?';
      params.push(isin);
    }
    if (valueDate) {
      sql += ' AND g.value_date = ?';
      params.push(valueDate);
    }
    if (maturityDate) {
      sql += ' AND g.maturity_date = ?';
      params.push(maturityDate);
    }
    if (asAtDate) {
      sql += ' AND g.value_date <= ?';
      params.push(asAtDate);
      // Exclude deals that have already matured on or before the report date.
      sql += ' AND g.maturity_date > ?';
      params.push(asAtDate);
    }
    
    // Deals: earliest maturity first, then ISIN / id as stable tiebreakers.
    sql += ` ORDER BY (g.maturity_date IS NULL) ASC, g.maturity_date ASC, g.isin_number, g.id`;

    console.log(`[GSEC Report] SQL Query: ${sql}`);
    console.log(`[GSEC Report] Params:`, params);

    // Query DB
    let rows;
    try {
      [rows] = await db.query(sql, params);
      console.log(`[GSEC Report] Query returned ${rows.length} rows`);
    } catch (queryError) {
      console.error('[GSEC Report] Database query error:', queryError);
      console.error('[GSEC Report] SQL:', sql);
      console.error('[GSEC Report] Params:', params);
      throw new Error(`Database query failed: ${queryError.message}`);
    }

  // Build a map of total sold per buy deal_number to compute remaining face value per row
  const dealNumbers = rows.map(r => (r.deal_number || '').trim()).filter(Boolean);
  const soldByDeal = await buildSoldByDealMap(db, dealNumbers, asAtDate);
  if (asAtDate) {
    console.log(`[GSEC Report] Sell reductions as at ${asAtDate}:`, soldByDeal);
  }

  // Fallback: allocate "unlinked" sells (missing/invalid buy_deal_number) using FIFO per ISIN/portfolio.
  // This makes the report resilient when sell rows do not correctly reference a buy deal_number.
  // Primary linkage remains buy_deal_number; fallback is only for sells not linked to any buy in `rows`.
  // Skip buyback-linked letter Sells (Buy/Sell blotter letters) — they have null buy_deal_number
  // but must not reduce holdings (same rule as buildSoldByDealMap).
  if (rows.length) {
    const uniqueIsinsForAllocation = [...new Set(rows.map(r => r.isin).filter(Boolean))];
    if (uniqueIsinsForAllocation.length) {
      const ph = uniqueIsinsForAllocation.map(() => '?').join(',');
      let sellAllocSql = `
        SELECT id, portfolio, isin_number AS isin, face_value, TRIM(buy_deal_number) AS buy_deal_number, value_date
        FROM gsec
        WHERE transaction_type = 'Sell' AND isin_number IN (${ph})
          AND buyback_deal_id IS NULL
      `;
      const sellAllocParams = [...uniqueIsinsForAllocation];
      if (portfolio) {
        sellAllocSql += ' AND portfolio = ?';
        sellAllocParams.push(portfolio);
      }
      if (asAtDate) {
        sellAllocSql += ' AND DATE(value_date) <= DATE(?)';
        sellAllocParams.push(asAtDate);
      }
      sellAllocSql += ' ORDER BY DATE(value_date), id';

      const [sellAllocRows] = await db.query(sellAllocSql, sellAllocParams);

      // Build FIFO buy lists per (portfolio|isin)
      const buyDealsByKey = {};
      rows.forEach(b => {
        const dealNo = (b.deal_number || '').trim();
        if (!dealNo || !b.isin) return;
        const key = `${String(b.portfolio || '').trim()}|${String(b.isin).trim()}`;
        if (!buyDealsByKey[key]) buyDealsByKey[key] = [];
        buyDealsByKey[key].push({
          deal_number: dealNo,
          face_value: Number(b.face_value) || 0,
          value_date: b.value_date,
          id: Number(b.id) || 0
        });
      });
      Object.keys(buyDealsByKey).forEach(key => {
        buyDealsByKey[key].sort((a, b) => {
          const ad = a.value_date ? String(a.value_date) : '';
          const bd = b.value_date ? String(b.value_date) : '';
          if (ad !== bd) return ad.localeCompare(bd);
          return (a.id || 0) - (b.id || 0);
        });
      });

      const buyDealSet = new Set(dealNumbers.map(d => d.trim()));

      for (const s of sellAllocRows) {
        const linkedDeal = (s.buy_deal_number || '').trim();
        // If sell is properly linked to a buy deal in this report, it was already counted in the grouped sell query above.
        if (linkedDeal && buyDealSet.has(linkedDeal)) continue;

        const sellKey = `${String(s.portfolio || '').trim()}|${String(s.isin || '').trim()}`;
        const fifoBuys = buyDealsByKey[sellKey];
        if (!fifoBuys || !fifoBuys.length) continue;

        let remainingToAllocate = Number(s.face_value) || 0;
        if (remainingToAllocate <= 0) continue;

        for (const b of fifoBuys) {
          if (remainingToAllocate <= 0) break;
          const alreadySold = Number(soldByDeal[b.deal_number] || 0);
          const maxSellable = Math.max(0, (Number(b.face_value) || 0) - alreadySold);
          if (maxSellable <= 0) continue;
          const alloc = Math.min(maxSellable, remainingToAllocate);
          soldByDeal[b.deal_number] = alreadySold + alloc;
          remainingToAllocate -= alloc;
        }
      }
    }
  }

  // ── ONE-TIME schema checks (avoid repeating inside loops) ──
  let hasPortfolioColumn = false;
  let hasTransactionTypeColumn = false;
  let hasSellDealAllocationsColumn = false;
  try {
    const [schemaCols] = await db.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'buyback_deals'
        AND COLUMN_NAME IN ('leg1_portfolio', 'leg1_transaction_type', 'sell_deal_allocations')
    `);
    const colSet = new Set(schemaCols.map(r => r.COLUMN_NAME));
    hasPortfolioColumn = colSet.has('leg1_portfolio');
    hasTransactionTypeColumn = colSet.has('leg1_transaction_type');
    hasSellDealAllocationsColumn = colSet.has('sell_deal_allocations');
  } catch (_) { /* leave all false */ }

  // ── BATCH repo_collateral by unique ISIN (2 queries total, not 2×N) ──
  const uniqueIsins = [...new Set(rows.map(r => r.isin).filter(Boolean))];
  const repoCollateralByIsin = {};
  if (uniqueIsins.length) {
    // Always compute portfolio balances as-of a date.
    // If caller does not pass asAtDate, default to current day so future-dated legs
    // (e.g., buyback leg2 buys) do not offset today's sell-side deductions.
    const effectiveAsAtDate = asAtDate || new Date().toISOString().split('T')[0];
    const ph = uniqueIsins.map(() => '?').join(',');
    // IMPORTANT: only deduct collateral for repo / reverse-repo deals that are
    // (a) still Active/Pending, AND
    // (b) not flagged as matured (the maturity flow sets matured=1 but does
    //     NOT change `status`, so a status-only filter leaks matured deals),
    // (c) whose maturity_date is still in the future relative to the
    //     report's as-at date - this safety net catches deals whose maturity
    //     processing was missed for whatever reason, AND
    // (d) not rejected in the approval workflow - rejecting a deal only
    //     updates `approval_status`/`current_approval_level`, never the
    //     separate lifecycle `status` column (see RepoDealModel.updateApprovalStatus),
    //     so a rejected deal's `status` stays 'Pending' and would otherwise keep
    //     locking up collateral it was never actually allowed to hold.
    const [childRows] = await db.query(`
      SELECT rdi.isin_number, COALESCE(SUM(rdi.face_value), 0) AS rc
      FROM repo_deal_isins rdi JOIN repo_deals rd ON rd.id = rdi.repo_deal_id
      WHERE rdi.isin_number IN (${ph})
        AND rd.status IN ('Active','Pending')
        AND COALESCE(rd.approval_status, '') <> 'rejected'
        AND COALESCE(rd.matured, 0) = 0
        AND (rd.maturity_date IS NULL OR DATE(rd.maturity_date) > DATE(?))
      GROUP BY rdi.isin_number`, [...uniqueIsins, effectiveAsAtDate]);
    childRows.forEach(r => { repoCollateralByIsin[r.isin_number] = Number(r.rc) || 0; });

    const [legacyRows] = await db.query(`
      SELECT rd.isin_number, COALESCE(SUM(rd.face_value), 0) AS rc
      FROM repo_deals rd LEFT JOIN repo_deal_isins rdi ON rdi.repo_deal_id = rd.id
      WHERE rdi.id IS NULL
        AND rd.isin_number IN (${ph})
        AND rd.status IN ('Active','Pending')
        AND COALESCE(rd.approval_status, '') <> 'rejected'
        AND COALESCE(rd.matured, 0) = 0
        AND (rd.maturity_date IS NULL OR DATE(rd.maturity_date) > DATE(?))
      GROUP BY rd.isin_number`, [...uniqueIsins, effectiveAsAtDate]);
    legacyRows.forEach(r => {
      repoCollateralByIsin[r.isin_number] = (repoCollateralByIsin[r.isin_number] || 0) + (Number(r.rc) || 0);
    });
  }

  // ── BATCH buyback deductions for ALL deal numbers in one query ──
  const allDealNumbers = rows.map(r => (r.deal_number || '').trim()).filter(Boolean);
  const buybackByDealBatch = {};
  if (allDealNumbers.length) {
    const uniqueIsinsForBB = [...new Set(rows.map(r => r.isin).filter(Boolean))];
    const ph = allDealNumbers.map(() => '?').join(',');
    const isinPh = uniqueIsinsForBB.map(() => '?').join(',');
    let bbSql = `SELECT leg1_face_value, source_buy_deal_number, leg1_isin${hasSellDealAllocationsColumn ? ', sell_deal_allocations' : ''}
      FROM buyback_deals WHERE deal_status = 'Approved'`;
    const bbParams = [];
    if (hasTransactionTypeColumn) bbSql += ` AND leg1_transaction_type = 'Sell'`;
    const bbCutoffDate = asAtDate || new Date().toISOString().split('T')[0];
    bbSql += ` AND approved_at IS NOT NULL AND DATE(leg1_value_date) <= DATE(?)`; bbParams.push(bbCutoffDate);
    bbSql += ` AND (source_buy_deal_number IN (${ph}) OR (source_buy_deal_number IS NULL AND leg1_isin IN (${isinPh})))`;
    bbParams.push(...allDealNumbers, ...uniqueIsinsForBB);
    if (hasPortfolioColumn && portfolio) { bbSql += ` AND leg1_portfolio = ?`; bbParams.push(portfolio); }
    bbSql += ` ORDER BY DATE(leg1_value_date) ASC, id ASC`;
    const [bbRows] = await db.query(bbSql, bbParams);

    // Build ISIN → buy deals (FIFO by value_date) for allocating NULL-source buybacks
    const buyDealsByIsin = {};
    rows.forEach(r => {
      const dealNo = (r.deal_number || '').trim();
      if (!dealNo || !r.isin) return;
      if (!buyDealsByIsin[r.isin]) buyDealsByIsin[r.isin] = [];
      buyDealsByIsin[r.isin].push({ deal_number: dealNo, face_value: Number(r.face_value) || 0 });
    });

    const allocateFIFO = (isin, amount, skipDeal) => {
      const candidates = buyDealsByIsin[isin];
      if (!candidates) return amount;
      let remaining = amount;
      for (const c of candidates) {
        if (remaining <= 0) break;
        if (skipDeal && c.deal_number === skipDeal) continue;
        const alreadyDeducted = Number(buybackByDealBatch[c.deal_number] || 0);
        const soldAgainst = Number(soldByDeal[c.deal_number] || 0);
        const available = Math.max(0, c.face_value - soldAgainst - alreadyDeducted);
        if (available <= 0) continue;
        const alloc = Math.min(remaining, available);
        buybackByDealBatch[c.deal_number] = alreadyDeducted + alloc;
        remaining -= alloc;
      }
      return remaining;
    };

    // Two-pass processing: precise allocations first so FIFO doesn't
    // consume capacity from deals that will be precisely allocated later.
    const parseBBAllocs = (r) => {
      if (!r.sell_deal_allocations) return null;
      try {
        const a = typeof r.sell_deal_allocations === 'string'
          ? JSON.parse(r.sell_deal_allocations) : r.sell_deal_allocations;
        return Array.isArray(a) && a.length > 0 ? a : null;
      } catch (_) { return null; }
    };

    const bbWithAllocs = [];
    const bbWithoutAllocs = [];
    for (const r of bbRows) {
      (parseBBAllocs(r) ? bbWithAllocs : bbWithoutAllocs).push(r);
    }

    // Pass 1: precise sell_deal_allocations
    for (const r of bbWithAllocs) {
      parseBBAllocs(r).forEach(a => {
        const dealNo = (a.deal_number || '').trim();
        const alloc = Number(a.amountToSell) || 0;
        if (dealNo && alloc > 0) {
          buybackByDealBatch[dealNo] = (Number(buybackByDealBatch[dealNo] || 0)) + alloc;
        }
      });
    }

    // Pass 2: source_buy_deal_number only (no FIFO fallback for unlinked buybacks).
    // Buybacks without an explicit source_buy_deal_number and without sell_deal_allocations
    // are NOT deducted in the report (restores pre-eb0468b behavior).
    for (const r of bbWithoutAllocs) {
      const amount = Number(r.leg1_face_value) || 0;
      const key = (r.source_buy_deal_number || '').trim();
      if (!key) continue;
      const alreadyDeducted = Number(buybackByDealBatch[key] || 0);
      const sourceDealInfo = buyDealsByIsin[r.leg1_isin]?.find(c => c.deal_number === key);
      const sourceFV = sourceDealInfo ? sourceDealInfo.face_value : 0;
      const soldAgainst = Number(soldByDeal[key] || 0);
      const capacity = Math.max(0, sourceFV - soldAgainst - alreadyDeducted);
      const directAlloc = Math.min(amount, capacity);
      if (directAlloc > 0) buybackByDealBatch[key] = alreadyDeducted + directAlloc;
      // Overflow beyond source deal capacity is NOT redistributed via FIFO (reverted).
    }
  }

  // ── Per-row calculations (no DB queries inside) ──
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    row.repo_collateral = repoCollateralByIsin[row.isin] || 0;

    const normalizedDealNumber = (row.deal_number || '').trim();
    const soldAgainstThisDeal = Number(soldByDeal[normalizedDealNumber] || 0);
    const originalFace = Number(row.face_value) || 0;
    const buybackDeduction = Number(buybackByDealBatch[normalizedDealNumber] || 0);

    row._direct_sold_against_deal = soldAgainstThisDeal;
    row._direct_buyback_against_deal = buybackDeduction;
    row.remaining_face_value_report = Math.max(0, originalFace - soldAgainstThisDeal - buybackDeduction);
    row.effective_remaining_face = resolveEffectiveRemainingFace(row);
    row.sell_back = 0;
  }

  // ── BATCH ISIN balance + WAP (one query for buys, one for sells, one for buyback) ──
  const isinBalances = {};
  const isinWapMap = {};
  const effectiveAsAtDate = asAtDate || new Date().toISOString().split('T')[0];

  if (uniqueIsins.length) {
    const ph = uniqueIsins.map(() => '?').join(',');

    // Buy totals per ISIN
    let buySql = `SELECT isin_number, SUM(face_value) AS total_fv, SUM(face_value * clean_price) AS sum_fvcp
      FROM gsec WHERE isin_number IN (${ph}) AND transaction_type = 'Buy' AND COALESCE(status, '') NOT IN ('cancelled', 'rejected')`;
    const buyParams = [...uniqueIsins];
    if (portfolio) { buySql += ' AND portfolio = ?'; buyParams.push(portfolio); }
    if (valueDate) { buySql += ' AND value_date = ?'; buyParams.push(valueDate); }
    if (maturityDate) { buySql += ' AND maturity_date = ?'; buyParams.push(maturityDate); }
    buySql += ' AND DATE(value_date) <= DATE(?)';
    buyParams.push(effectiveAsAtDate);
    buySql += ' GROUP BY isin_number';
    const [buyAggRows] = await db.query(buySql, buyParams);
    buyAggRows.forEach(r => {
      isinBalances[r.isin_number] = Number(r.total_fv) || 0;
      isinWapMap[r.isin_number] = { sumFV: Number(r.total_fv) || 0, sumFVCP: Number(r.sum_fvcp) || 0 };
    });

    // Sell totals per ISIN (exclude buyback letter Sells — not real inventory)
    let sellSql = `SELECT isin_number, COALESCE(SUM(face_value), 0) AS sold
      FROM gsec WHERE isin_number IN (${ph}) AND transaction_type = 'Sell'
        AND buyback_deal_id IS NULL`;
    const sellParams = [...uniqueIsins];
    if (portfolio) { sellSql += ' AND portfolio = ?'; sellParams.push(portfolio); }
    if (valueDate) { sellSql += ' AND value_date = ?'; sellParams.push(valueDate); }
    if (maturityDate) { sellSql += ' AND maturity_date = ?'; sellParams.push(maturityDate); }
    sellSql += ' AND DATE(value_date) <= DATE(?)';
    sellParams.push(effectiveAsAtDate);
    sellSql += ' GROUP BY isin_number';
    const [sellAggRows] = await db.query(sellSql, sellParams);
    sellAggRows.forEach(r => {
      isinBalances[r.isin_number] = Math.max(0, (isinBalances[r.isin_number] || 0) - (Number(r.sold) || 0));
    });

    // Buyback deductions per ISIN (single batched query)
    let bbIsinSql = `SELECT leg1_isin, COALESCE(SUM(leg1_face_value), 0) AS bb
      FROM buyback_deals WHERE leg1_isin IN (${ph}) AND deal_status = 'Approved'`;
    const bbIsinParams = [...uniqueIsins];
    if (hasTransactionTypeColumn) bbIsinSql += ` AND leg1_transaction_type = 'Sell'`;
    bbIsinSql += ` AND approved_at IS NOT NULL AND DATE(leg1_value_date) <= DATE(?)`;
    bbIsinParams.push(effectiveAsAtDate);
    if (hasPortfolioColumn && portfolio) { bbIsinSql += ' AND leg1_portfolio = ?'; bbIsinParams.push(portfolio); }
    bbIsinSql += ' GROUP BY leg1_isin';
    const [bbIsinRows] = await db.query(bbIsinSql, bbIsinParams);
    bbIsinRows.forEach(r => {
      isinBalances[r.leg1_isin] = Math.max(0, (isinBalances[r.leg1_isin] || 0) - (Number(r.bb) || 0));
    });
  }
  // Fill defaults for ISINs with no buy data
  uniqueIsins.forEach(isin => {
    if (!(isin in isinBalances)) isinBalances[isin] = 0;
    if (!(isin in isinWapMap)) isinWapMap[isin] = { sumFV: 0, sumFVCP: 0 };
  });

  // Helper to safely parse ISO date strings
  function safeParseISO(val) {
    if (!val) return null;
    if (typeof val === 'string') return parseISO(val);
    if (val instanceof Date) return val;
    return null;
  }

  // Use asAtDate for NVP calculation if provided, otherwise use current system date
  // This ensures NVP is calculated to the asAtDate (historical date) when viewing past reports
  const valueDateForNVP = asAtDate || new Date().toISOString().split('T')[0];

  // Hide deals that have zero remaining face value as at report date,
  // and deals already matured on or before the report date.
  const asAtYmd = asAtDate ? clampToYmd(asAtDate) : null;
  const visibleRows = rows.filter(row => {
    if (Number(row.effective_remaining_face ?? 0) <= 0) return false;
    if (asAtYmd) {
      // Historical/dated report: a deal is only "off the report" once its maturity
      // date has passed the report's as-at date — not because it has since matured
      // in real time (the persisted `matured` flag reflects today's state, not asAtDate's).
      const matYmd = clampToYmd(row.maturity_date);
      if (matYmd && matYmd <= asAtYmd) return false;
    } else if (Number(row.matured) === 1) {
      return false;
    }
    return true;
  });

  // Format results
  const data = visibleRows.map(row => {
    const maturityDateObj = safeParseISO(row.maturity_date);
    const asAtDateObj = safeParseISO(asAtDate);
    let dtm = '';
    if (maturityDateObj && asAtDateObj) {
      dtm = differenceInDays(maturityDateObj, asAtDateObj);
    }

    // Calculate NVP using asAtDate as value date (same calculation as fixed income entry form)
    // This matches the clean price calculation logic from the frontend
    const nvpResult = calculateNVP({
      faceValue: row.face_value,
      couponRate: row.coupon_rate,
      yieldRate: row.yield,
      systemDate: valueDateForNVP, // Use asAtDate if provided, otherwise current date
      maturityDate: row.maturity_date,
      issueDate: row.issue_date,
      couponDate1: row.coupon_date_1,
      couponDate2: row.coupon_date_2
    });

    // Calculate available balance: deal face value - repo_collateral (deal-wise calculation)
    const dealFaceValue = Number(row.effective_remaining_face ?? row.face_value) || 0;
    const repoCollateral = Number(row.repo_collateral) || 0;
    // Clamp to >= 0. A negative number here would only happen if matured / closed
    // repo deals are still being deducted (data drift), which is misleading for the
    // user and breaks downstream balance validation. The matured-deal filter on the
    // repo-collateral queries above is the primary defense; this clamp is a safety net.
    const availableBalance = Math.max(0, dealFaceValue - repoCollateral);

    console.log(`Deal ${row.deal_number}: dealFaceValue=${dealFaceValue}, repoCollateral=${repoCollateral}, availableBalance=${availableBalance}`);

    // Recompute daily accrual for report date so stale persisted values do not leak into output.
    // Fallback to stored DB value only when recomputation is not possible for the row.
    const accrualAsOfDate = asAtDate || new Date().toISOString().split('T')[0];
    const normalizedDealNumberForAccrual = (row.deal_number || '').trim();
    const soldAgainstForAccrual = Number(soldByDeal[normalizedDealNumberForAccrual] || 0);
    const buybackAgainstForAccrual = Number(buybackByDealBatch[normalizedDealNumberForAccrual] || 0);
    const computedDailyAccrual = computeGsecPerDayAccrual(
      {
        face_value: row.face_value,
        remaining_face_value: row.effective_remaining_face ?? row.face_value,
        coupon_interest: row.coupon_interest,
        maturity_date: row.maturity_date,
        isin_number: row.isin,
        coupon_date_1: row.coupon_date_1,
        coupon_date_2: row.coupon_date_2,
        coupon_rate: row.coupon_rate,
        linked_sold_face_value: soldAgainstForAccrual,
        linked_buyback_face_value: buybackAgainstForAccrual
      },
      accrualAsOfDate,
      2
    );
    const dailyAccrual = computedDailyAccrual.ok
      ? Number(computedDailyAccrual.amount)
      : (Number(row.daily_accrual) || 0);
    const dailyAmort = Number(row.daily_amortization) || 0;

    // Cumulative amortization from purchase date (value_date) to asAtDate (or today if missing)
    const effectiveAsAt = asAtDate || new Date().toISOString().split('T')[0];
    const endYmd = clampToYmd(effectiveAsAt);
    const matYmd = clampToYmd(row.maturity_date);
    const startYmd = clampToYmd(row.value_date);
    const cappedEnd = matYmd && endYmd && endYmd > matYmd ? matYmd : endYmd;
    let holdingDays = startYmd && cappedEnd ? Math.max(0, utcDayDiffSigned(cappedEnd, startYmd)) : 0;
    // Exclude maturity day from cumulative amortization if report date is maturity
    if (matYmd && cappedEnd === matYmd) holdingDays = Math.max(0, holdingDays - 1);
    const cumulativeAmort = truncate8(dailyAmort * holdingDays);

    // Cumulative accrual since purchase date up to asAtDate (scaled to remaining face as at report)
    let cumulativeAccrual = 0;
    try {
      const effectiveFace = Number(row.effective_remaining_face ?? row.face_value) || 0;
      const effectiveCouponInterest = periodCouponOnFace(effectiveFace, row.coupon_rate, row.coupon_interest, row.face_value);

      const accStart = startYmd;
      const accEnd = cappedEnd;
      if (effectiveCouponInterest > 0 && accStart && accEnd && accEnd > accStart && matYmd) {
        let cursor = accStart;
        const maxIters = 20; // safety (semiannual; 10y => 20 periods)
        for (let iter = 0; iter < maxIters && cursor < accEnd; iter += 1) {
          const { coupon_date_1: c1, coupon_date_2: c2 } = resolveIsinCouponDates({
            isin_number: row.isin,
            coupon_date_1: row.coupon_date_1,
            coupon_date_2: row.coupon_date_2
          });
          const sched = getCouponPeriodLengthDaysFromIsinSchedule(cursor, matYmd, c1, c2);
          if (!sched || !sched.E || sched.E <= 0) break;
          const nextCouponYmd = sched.nextCoupon.toISOString().slice(0, 10);
          const sliceEnd = nextCouponYmd < accEnd ? nextCouponYmd : accEnd;
          const daysInSlice = Math.max(0, utcDayDiffSigned(sliceEnd, cursor));
          if (daysInSlice > 0) {
            const perDay = effectiveCouponInterest / sched.E;
            cumulativeAccrual = truncate8(cumulativeAccrual + perDay * daysInSlice);
          }
          cursor = sliceEnd;
          // If we landed exactly on next coupon, continue into next period.
          if (cursor < accEnd && cursor === nextCouponYmd) {
            // advance by 0 days; loop recomputes next period
          }
        }
      }
    } catch (_) {
      cumulativeAccrual = 0;
    }

    // Last/next coupon date as at the report date (asAtDate), derived from the ISIN
    // coupon calendar rather than the stored deal field (which reflects deal entry).
    // Format from local Y/M/D components; using toISOString() here would shift the
    // calendar date back one day in positive-offset timezones (e.g. 15-Nov -> 14-Nov).
    const fmtLocalYmd = (dt) => {
      if (!dt) return null;
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };
    let lastCouponDate = null;
    let nextCouponDate = null;
    try {
      const { coupon_date_1: lc1, coupon_date_2: lc2 } = resolveIsinCouponDates({
        isin_number: row.isin,
        coupon_date_1: row.coupon_date_1,
        coupon_date_2: row.coupon_date_2
      });
      const lcSched = getCouponPeriodLengthDaysFromIsinSchedule(effectiveAsAt, row.maturity_date, lc1, lc2);
      if (lcSched) {
        lastCouponDate = fmtLocalYmd(lcSched.lastCoupon);
        nextCouponDate = fmtLocalYmd(lcSched.nextCoupon);
      }
    } catch (_) {
      lastCouponDate = null;
      nextCouponDate = null;
    }

    return {
      id: row.id,
      product_type: 'GSec',
      portfolio: row.portfolio,
      custodian: '', // custodian column doesn't exist in gsec table
      deal_number: row.deal_number || '',
      // Face Value column: stored remaining_face_value on the buy row when set, else sell/buyback-derived
      face_value: formatCurrency(row.effective_remaining_face ?? row.face_value, 2),
      issue_date: row.issue_date || null,
      last_coupon_date: lastCouponDate,
      next_coupon_date: nextCouponDate,
      value_date: row.value_date,
      maturity_date: row.maturity_date,
      isin: row.isin,
      coupon_rate: formatPercentage(row.coupon_rate, 4),
      // Coupon for the face still held (matches the Face Value column), not the stored entry-time figure
      coupon_interest: formatPrice(periodCouponOnFace(row.effective_remaining_face ?? row.face_value, row.coupon_rate, row.coupon_interest, row.face_value), 4),
      clean_price: formatPrice(row.clean_price, 4),
      dirty_price: formatPrice(row.dirty_price, 4),
      // Amount = price * (remaining/displayed) face value / 100
      clean_price_amount: formatCurrency((Number(row.clean_price) || 0) * dealFaceValue / 100, 2),
      dirty_price_amount: formatCurrency((Number(row.dirty_price) || 0) * dealFaceValue / 100, 2),
      yield: formatPercentage(row.yield, 4),
      dtm: dtm ? dtm.toLocaleString('en-US') : '',
      balance: formatPrice(isinBalances[row.isin], 4),
      available_balance: formatPrice(availableBalance, 4),
      wap: (function() {
        const wapData = isinWapMap[row.isin];
        if (wapData && wapData.sumFV) {
          const wapValue = Math.floor((wapData.sumFVCP / wapData.sumFV) * 10000) / 10000;
          return formatPrice(wapValue, 4);
        }
        return '';
      })(),
      nvp: nvpResult.nvp ? formatPrice(nvpResult.nvp, 4) : '',
      accrued_interest: nvpResult.accruedInterest ? formatPrice(nvpResult.accruedInterest, 4) : '',
      repo_collateral: row.repo_collateral ? formatPrice(row.repo_collateral, 4) : '0.0000',
      sell_back: row.sell_back ? formatCurrency(row.sell_back, 2) : '0.00',
      daily_accrual: formatPrice(dailyAccrual, 8),
      daily_amortization: formatPrice(dailyAmort, 8),
      cumulative_accrual: formatPrice(cumulativeAccrual, 8),
      cumulative_amortization: formatPrice(cumulativeAmort, 8),
      counterparty: row.counterparty_name || (row.counterparty_id ? String(row.counterparty_id) : ''),
      transaction_type: row.transaction_type || ''
    };
  });

  // ── ISIN-wise summary ──────────────────────────────────────────────────────
  // One row per ISIN across ALL outstanding buy rows for the applied filters
  // (independent of pagination). Per business decision:
  //   - total_face_value      = sum of remaining/outstanding face for the ISIN
  //   - weighted_avg_price    = SIMPLE arithmetic average of clean price across deals
  //   - weighted_yield        = SIMPLE arithmetic average of yield across deals
  // (Every outstanding deal counts equally; not face-weighted.)
  const summaryByIsin = {};
  visibleRows.forEach(row => {
    const key = row.isin;
    if (!key) return;
    const face = Number(row.effective_remaining_face ?? row.face_value) || 0;
    const clean = Number(row.clean_price) || 0;
    const yld = Number(row.yield) || 0;
    if (!summaryByIsin[key]) {
      summaryByIsin[key] = {
        isin: key,
        totalFace: 0,
        sumClean: 0,
        sumYield: 0,
        dealCount: 0,
        // Bond maturity is ISIN-level; take the first deal's maturity_date.
        maturity_date: clampToYmd(row.maturity_date)
      };
    }
    const s = summaryByIsin[key];
    s.totalFace += face;
    s.sumClean += clean;
    s.sumYield += yld;
    s.dealCount += 1;
    if (!s.maturity_date) s.maturity_date = clampToYmd(row.maturity_date);
  });

  const summary = Object.values(summaryByIsin)
    // Shorter maturity first, then ISIN as tiebreaker.
    .sort((a, b) => {
      const da = String(a.maturity_date || '');
      const db_ = String(b.maturity_date || '');
      if (da && db_ && da !== db_) return da.localeCompare(db_);
      if (da && !db_) return -1;
      if (!da && db_) return 1;
      return String(a.isin).localeCompare(String(b.isin));
    })
    .map(s => ({
      isin: s.isin,
      maturity_date: s.maturity_date || '',
      deal_count: s.dealCount,
      total_face_value: formatCurrency(s.totalFace, 2),
      weighted_avg_price: formatPrice(s.dealCount ? s.sumClean / s.dealCount : 0, 4),
      weighted_yield: formatPrice(s.dealCount ? s.sumYield / s.dealCount : 0, 4)
    }));

  // Calculate total portfolio balance when portfolio filter is applied
  let totalPortfolioBalance = null;
  if (portfolio) {
    // Calculate total balance using remaining face value (stored on row, or sell/buyback-derived)
    const balanceSql = `SELECT g.deal_number, g.face_value, g.remaining_face_value, g.isin_number AS isin FROM gsec g WHERE g.transaction_type = 'Buy' AND COALESCE(g.status, '') NOT IN ('cancelled', 'rejected') AND COALESCE(g.matured, 0) = 0 AND NOT (g.buyback_deal_id IS NOT NULL AND EXISTS (SELECT 1 FROM buyback_deals bd_letter WHERE bd_letter.id = g.buyback_deal_id AND bd_letter.leg1_transaction_type = 'Buy' AND bd_letter.leg2_transaction_type = 'Sell'))` +
      (portfolio ? ' AND g.portfolio = ?' : '') +
      (isin ? ' AND g.isin_number = ?' : '') +
      (valueDate ? ' AND g.value_date = ?' : '') +
      (maturityDate ? ' AND g.maturity_date = ?' : '') +
      (asAtDate ? ' AND g.value_date <= ? AND g.maturity_date > ?' : '');
    
    const balanceParams = [];
    if (portfolio) balanceParams.push(portfolio);
    if (isin) balanceParams.push(isin);
    if (valueDate) balanceParams.push(valueDate);
    if (maturityDate) balanceParams.push(maturityDate);
    if (asAtDate) {
      balanceParams.push(asAtDate);
      balanceParams.push(asAtDate);
    }
    
    const [balanceRows] = await db.query(balanceSql, balanceParams);
    
    // Calculate remaining face value for each deal (same logic as in main query)
    const dealNumbers = balanceRows.map(r => (r.deal_number || '').trim()).filter(Boolean);
    const soldByDeal = await buildSoldByDealMap(db, dealNumbers, asAtDate);

    // Same fallback as main table: allocate unlinked sells FIFO per ISIN/portfolio
    // so total balance matches deal-level rows even when sell rows are not linked correctly.
    // Skip buyback letter Sells (null buy_deal_number but not real inventory).
    if (balanceRows.length) {
      const [isinRows] = await db.query(
        `SELECT DISTINCT isin_number FROM gsec WHERE transaction_type = 'Buy' AND COALESCE(status, '') NOT IN ('cancelled', 'rejected')` +
          (portfolio ? ' AND portfolio = ?' : '') +
          (isin ? ' AND isin_number = ?' : '') +
          (valueDate ? ' AND value_date = ?' : '') +
          (maturityDate ? ' AND maturity_date = ?' : '') +
          (asAtDate ? ' AND value_date <= ?' : ''),
        balanceParams
      );
      const uniqueIsinsForAllocation = [...new Set(isinRows.map(r => r.isin_number).filter(Boolean))];
      if (uniqueIsinsForAllocation.length) {
        const ph = uniqueIsinsForAllocation.map(() => '?').join(',');
        let sellAllocSql = `
          SELECT id, portfolio, isin_number AS isin, face_value, TRIM(buy_deal_number) AS buy_deal_number, value_date
          FROM gsec
          WHERE transaction_type = 'Sell' AND isin_number IN (${ph})
            AND buyback_deal_id IS NULL
        `;
        const sellAllocParams = [...uniqueIsinsForAllocation];
        if (portfolio) { sellAllocSql += ' AND portfolio = ?'; sellAllocParams.push(portfolio); }
        if (asAtDate) { sellAllocSql += ' AND DATE(value_date) <= DATE(?)'; sellAllocParams.push(asAtDate); }
        sellAllocSql += ' ORDER BY DATE(value_date), id';

        const [sellAllocRows] = await db.query(sellAllocSql, sellAllocParams);

        // Need buy lists for FIFO allocation: fetch buy deal meta for these ISINs in this filtered scope.
        const buyDealsByKey = {};
        const buyMetaSql =
          `SELECT id, portfolio, deal_number, isin_number AS isin, face_value, value_date
           FROM gsec
           WHERE transaction_type = 'Buy' AND COALESCE(status, '') NOT IN ('cancelled', 'rejected') AND isin_number IN (${ph})` +
          (portfolio ? ' AND portfolio = ?' : '') +
          (isin ? ' AND isin_number = ?' : '') +
          (valueDate ? ' AND value_date = ?' : '') +
          (maturityDate ? ' AND maturity_date = ?' : '') +
          (asAtDate ? ' AND value_date <= ?' : '') +
          ' ORDER BY DATE(value_date), id';

        const buyMetaParams = [...uniqueIsinsForAllocation];
        if (portfolio) buyMetaParams.push(portfolio);
        if (isin) buyMetaParams.push(isin);
        if (valueDate) buyMetaParams.push(valueDate);
        if (maturityDate) buyMetaParams.push(maturityDate);
        if (asAtDate) buyMetaParams.push(asAtDate);

        const [buyMetaRows] = await db.query(buyMetaSql, buyMetaParams);
        buyMetaRows.forEach(b => {
          const dealNo = (b.deal_number || '').trim();
          if (!dealNo || !b.isin) return;
          const key = `${String(b.portfolio || '').trim()}|${String(b.isin).trim()}`;
          if (!buyDealsByKey[key]) buyDealsByKey[key] = [];
          buyDealsByKey[key].push({
            deal_number: dealNo,
            face_value: Number(b.face_value) || 0,
            value_date: b.value_date,
            id: Number(b.id) || 0
          });
        });

        const buyDealSet = new Set(dealNumbers.map(d => d.trim()));
        for (const s of sellAllocRows) {
          const linkedDeal = (s.buy_deal_number || '').trim();
          if (linkedDeal && buyDealSet.has(linkedDeal)) continue;

          const sellKey = `${String(s.portfolio || '').trim()}|${String(s.isin || '').trim()}`;
          const fifoBuys = buyDealsByKey[sellKey];
          if (!fifoBuys || !fifoBuys.length) continue;

          let remainingToAllocate = Number(s.face_value) || 0;
          if (remainingToAllocate <= 0) continue;

          for (const b of fifoBuys) {
            if (remainingToAllocate <= 0) break;
            const alreadySold = Number(soldByDeal[b.deal_number] || 0);
            const maxSellable = Math.max(0, (Number(b.face_value) || 0) - alreadySold);
            if (maxSellable <= 0) continue;
            const alloc = Math.min(maxSellable, remainingToAllocate);
            soldByDeal[b.deal_number] = alreadySold + alloc;
            remainingToAllocate -= alloc;
          }
        }
      }
    }
    
    // Always calculate buyback deductions (not just for historical dates)
    const buybackByDeal = {};
    if (dealNumbers.length) {
      const bbCutoff = asAtDate || new Date().toISOString().split('T')[0];
      const balanceIsins = [...new Set(balanceRows.map(r => r.isin).filter(Boolean))];
      const placeholders = dealNumbers.map(() => '?').join(',');
      const isinPh = balanceIsins.map(() => '?').join(',');
      let buybackSql = `
        SELECT source_buy_deal_number, leg1_face_value, leg1_isin${hasSellDealAllocationsColumn ? ', sell_deal_allocations' : ''}
        FROM buyback_deals
        WHERE`;
      
      if (hasTransactionTypeColumn) {
        buybackSql += ` leg1_transaction_type = 'Sell' AND`;
      }
      
      buybackSql += ` deal_status = 'Approved'
        AND approved_at IS NOT NULL AND DATE(leg1_value_date) <= DATE(?)
        AND (source_buy_deal_number IN (${placeholders}) OR (source_buy_deal_number IS NULL AND leg1_isin IN (${isinPh})))
        ORDER BY DATE(leg1_value_date) ASC, id ASC
      `;
      const buybackParams = [bbCutoff, ...dealNumbers, ...balanceIsins];
      const [buybackRows] = await db.query(buybackSql, buybackParams);

      // Build ISIN → deal list for FIFO allocation of NULL-source buybacks
      const balBuysByIsin = {};
      balanceRows.forEach(r => {
        const dn = (r.deal_number || '').trim();
        if (!dn || !r.isin) return;
        if (!balBuysByIsin[r.isin]) balBuysByIsin[r.isin] = [];
        balBuysByIsin[r.isin].push({ deal_number: dn, face_value: Number(r.face_value) || 0 });
      });

      const allocFIFO2 = (isin, amount, skipDeal) => {
        const candidates = balBuysByIsin[isin];
        if (!candidates) return amount;
        let remaining = amount;
        for (const c of candidates) {
          if (remaining <= 0) break;
          if (skipDeal && c.deal_number === skipDeal) continue;
          const alreadyDeducted = Number(buybackByDeal[c.deal_number] || 0);
          const sold = Number(soldByDeal[c.deal_number] || 0);
          const available = Math.max(0, c.face_value - sold - alreadyDeducted);
          if (available <= 0) continue;
          const alloc = Math.min(remaining, available);
          buybackByDeal[c.deal_number] = alreadyDeducted + alloc;
          remaining -= alloc;
        }
        return remaining;
      };

      // Two-pass processing: precise allocations first so FIFO doesn't
      // consume capacity from deals that will be precisely allocated later.
      const parseBBAllocs2 = (r) => {
        if (!r.sell_deal_allocations) return null;
        try {
          const a = typeof r.sell_deal_allocations === 'string'
            ? JSON.parse(r.sell_deal_allocations) : r.sell_deal_allocations;
          return Array.isArray(a) && a.length > 0 ? a : null;
        } catch (_) { return null; }
      };

      const bbWithAllocs2 = [];
      const bbWithoutAllocs2 = [];
      for (const row of buybackRows) {
        (parseBBAllocs2(row) ? bbWithAllocs2 : bbWithoutAllocs2).push(row);
      }

      // Pass 1: precise sell_deal_allocations
      for (const row of bbWithAllocs2) {
        parseBBAllocs2(row).forEach(a => {
          const dealNo = (a.deal_number || '').trim();
          const alloc = Number(a.amountToSell) || 0;
          if (dealNo && alloc > 0) {
            buybackByDeal[dealNo] = (Number(buybackByDeal[dealNo] || 0)) + alloc;
          }
        });
      }

      // Pass 2: source_buy_deal_number only (no FIFO fallback for unlinked buybacks).
      // Buybacks without an explicit source_buy_deal_number and without sell_deal_allocations
      // are NOT deducted in the portfolio total (restores pre-eb0468b behavior).
      for (const row of bbWithoutAllocs2) {
        const amount = Number(row.leg1_face_value) || 0;
        const key = (row.source_buy_deal_number || '').trim();
        if (!key) continue;
        const alreadyDeducted = Number(buybackByDeal[key] || 0);
        const sourceDealInfo = balBuysByIsin[row.leg1_isin]?.find(c => c.deal_number === key);
        const sourceFV = sourceDealInfo ? sourceDealInfo.face_value : 0;
        const sold = Number(soldByDeal[key] || 0);
        const capacity = Math.max(0, sourceFV - sold - alreadyDeducted);
        const directAlloc = Math.min(amount, capacity);
        if (directAlloc > 0) buybackByDeal[key] = alreadyDeducted + directAlloc;
        // Overflow beyond source deal capacity is NOT redistributed via FIFO (reverted).
      }
    }
    
    // Accumulate in integer cents so floating-point drift from summing many
    // DECIMAL(18,2) values (e.g. a spurious trailing 0.02) never shows up in
    // the portfolio total.
    let totalBalanceCents = 0;
    balanceRows.forEach(balanceRow => {
      const originalFaceCents = Math.round((Number(balanceRow.face_value) || 0) * 100);
      const normalizedDealNumber = (balanceRow.deal_number || '').trim();
      const soldAgainstThisDealCents = Math.round((Number(soldByDeal[normalizedDealNumber] || 0)) * 100);
      const buybackDeductionCents = Math.round((Number(buybackByDeal[normalizedDealNumber] || 0)) * 100);
      const remainingFaceValueCents = Math.max(
        0,
        originalFaceCents - soldAgainstThisDealCents - buybackDeductionCents
      );
      totalBalanceCents += remainingFaceValueCents;
    });
    const totalBalance = totalBalanceCents / 100;

    totalPortfolioBalance = formatPrice(totalBalance, 4);
    console.log(`Portfolio ${portfolio} total balance: ${totalPortfolioBalance}`);
  }

  const total = data.length;
  let paginatedData = data;
  if (page && pageSize) {
    const pageSizeNum = parseInt(pageSize, 10);
    const pageNum = parseInt(page, 10);
    const offset = (pageNum - 1) * pageSizeNum;
    paginatedData = data.slice(offset, offset + pageSizeNum);
  }

  return { data: paginatedData, total, totalPortfolioBalance, summary };
  } catch (error) {
    console.error('[GSEC Report Service] Error:', error);
    console.error('[GSEC Report Service] Error message:', error.message);
    console.error('[GSEC Report Service] Error stack:', error.stack);
    throw error; // Re-throw to be caught by controller
  }
};
