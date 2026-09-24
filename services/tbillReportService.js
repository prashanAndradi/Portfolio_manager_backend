const db = require('../config/db');
const { differenceInDays, parseISO } = require('date-fns');
const { isTransactionsView, resolveTransactionDateRange, appendValueDateRange } = require('./reportViewHelper');
const { computeTbillDailyAccrual } = require('./tbillLedgerService');

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

function clampToYmd(x) {
  const d = new Date(x);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function safeParseISO(val) {
  if (!val) return null;
  if (typeof val === 'string') return parseISO(val);
  if (val instanceof Date) return val;
  return null;
}

function resolveEffectiveRemainingFace(row) {
  const face = Math.max(0, Number(row.face_value) || 0);
  const sold = Number(row._direct_sold_against_deal ?? 0);
  if (sold <= 0) return face;
  return Math.max(0, Number(row.remaining_face_value_report ?? face) || 0);
}

/**
 * Per-day accrual and accrued interest to date for the face held as at the report date.
 * Uses the EOD's own daily formula on the held face (not the stored per_day_accrual /
 * accrued_interest_to_date, which follow the stored remaining face and are wrong for past
 * as-at dates or if that balance drifts). Finance day count: (as-at - value date) - 1 days.
 */
function heldFaceAccrual(row, heldFace, asAtYmd) {
  const computed = computeTbillDailyAccrual({ ...row, remaining_face_value: heldFace });
  if (!computed.ok) return { perDay: 0, accrued: 0, days: 0 };
  const valueYmd = clampToYmd(row.value_date);
  const tenor = Number(row.days_to_maturity) || 0;
  let days = valueYmd && asAtYmd ? Math.round((Date.parse(asAtYmd) - Date.parse(valueYmd)) / 86400000) - 1 : 0;
  days = Math.max(0, Math.min(days, tenor));
  return { perDay: computed.amount, accrued: computed.amount * days, days };
}

function resolvePortfolioDisplay(row) {
  if (row.portfolio_name) return String(row.portfolio_name);
  if (row.portfolio_key) return String(row.portfolio_key);
  const pid = row.portfolio_id;
  if (pid != null && String(pid).trim() !== '' && String(pid) !== '0') {
    return String(pid);
  }
  return '';
}

const TBILL_SELECT_SQL = `
      SELECT t.id, t.deal_number, t.trade_date, t.value_date, t.transaction_type,
             t.isin_number, t.maturity_date, t.face_value, t.discount_rate_pct,
             t.days_to_maturity, t.price_per_100, t.settlement_amount,
             t.portfolio_id, t.per_day_accrual, t.accrued_interest_to_date,
             t.counterparty, t.matured, t.status, t.buy_deal_number,
             pm.portfolio_name,
             pm.portfolio_id AS portfolio_key,
             COALESCE(
               corp.short_name,
               ind.short_name,
               joint.short_name,
               CONCAT('ID:', t.counterparty)
             ) AS counterparty_name
      FROM tbill t
      LEFT JOIN counterparty_master_corporate corp
        ON (t.counterparty LIKE 'c%' AND CAST(SUBSTRING(t.counterparty, 2) AS UNSIGNED) = corp.id)
        OR (t.counterparty = corp.id)
      LEFT JOIN counterparty_master_individual ind
        ON (t.counterparty LIKE 'i%' AND CAST(SUBSTRING(t.counterparty, 2) AS UNSIGNED) = ind.id)
        OR (t.counterparty = ind.id)
      LEFT JOIN counterparty_master_joint joint
        ON (t.counterparty LIKE 'j%' AND CAST(SUBSTRING(t.counterparty, 2) AS UNSIGNED) = joint.id)
        OR (t.counterparty = joint.id)
      LEFT JOIN portfolio_master pm
        ON CAST(t.portfolio_id AS CHAR) COLLATE utf8mb4_unicode_ci
         = CAST(pm.portfolio_id AS CHAR) COLLATE utf8mb4_unicode_ci`;

async function getTbillTransactionsReport({ asAtDate, portfolio, isin, valueDate, maturityDate, dateFrom, dateTo, page, pageSize }) {
  const range = resolveTransactionDateRange({ dateFrom, dateTo, asAtDate, valueDate });
  let sql = `${TBILL_SELECT_SQL}
      WHERE t.transaction_type IN ('Buy', 'Sell')
        AND COALESCE(t.status, '') NOT IN ('cancelled', 'rejected')`;
  const params = [];

  if (portfolio) {
    sql += ' AND t.portfolio_id = ?';
    params.push(String(portfolio));
  }
  if (isin) {
    sql += ' AND t.isin_number = ?';
    params.push(isin);
  }
  sql = appendValueDateRange(sql, params, 't.value_date', range);
  if (maturityDate) {
    sql += ' AND DATE(t.maturity_date) = DATE(?)';
    params.push(maturityDate);
  }

  sql += ' ORDER BY t.value_date DESC, t.id DESC';
  const [rows] = await db.query(sql, params);

  const data = rows.map((row) => {
    const originalFace = Number(row.face_value) || 0;
    const originalSettlement = Number(row.settlement_amount) || 0;
    const maturityDateObj = safeParseISO(row.maturity_date);
    const valueDateObj = safeParseISO(row.value_date);
    let dtm = '';
    if (maturityDateObj && valueDateObj) {
      dtm = Math.max(0, differenceInDays(maturityDateObj, valueDateObj));
    }
    return {
      id: row.id,
      product_type: 'T-Bill',
      deal_number: row.deal_number || '',
      trade_date: row.trade_date,
      value_date: row.value_date,
      transaction_type: row.transaction_type || '',
      counterparty: row.counterparty_name || (row.counterparty ? String(row.counterparty) : ''),
      isin_number: row.isin_number || '',
      maturity_date: row.maturity_date,
      face_value: formatCurrency(originalFace, 2),
      discount_rate_pct: formatPercentage(row.discount_rate_pct, 2),
      days_to_maturity: dtm !== '' ? String(dtm) : '',
      price_per_100: formatPrice(row.price_per_100, 2),
      settlement_amount: formatCurrency(originalSettlement, 2),
      portfolio: resolvePortfolioDisplay(row),
      buy_deal_number: row.buy_deal_number || '',
      status: row.status || '',
      remaining_face_value: '',
      per_day_accrual: formatPrice(row.per_day_accrual, 2),
      accrued_interest_to_date: formatPrice(row.accrued_interest_to_date, 2)
    };
  });

  const total = data.length;
  let paginatedData = data;
  if (page && pageSize) {
    const pageSizeNum = parseInt(pageSize, 10);
    const pageNum = parseInt(page, 10);
    const offset = (pageNum - 1) * pageSizeNum;
    paginatedData = data.slice(offset, offset + pageSizeNum);
  }

  return { data: paginatedData, total, totalPortfolioBalance: null };
}

exports.getTbillReport = async ({ asAtDate, portfolio, isin, valueDate, maturityDate, dateFrom, dateTo, page, pageSize, view }) => {
  try {
    if (isTransactionsView(view)) {
      return getTbillTransactionsReport({ asAtDate, portfolio, isin, valueDate, maturityDate, dateFrom, dateTo, page, pageSize });
    }

    let sql = `${TBILL_SELECT_SQL}
      WHERE t.transaction_type = 'Buy'
        AND t.status = 'final_approved'`;
    const params = [];

    if (portfolio) {
      sql += ' AND t.portfolio_id = ?';
      params.push(String(portfolio));
    }
    if (isin) {
      sql += ' AND t.isin_number = ?';
      params.push(isin);
    }
    if (valueDate) {
      sql += ' AND DATE(t.value_date) = DATE(?)';
      params.push(valueDate);
    }
    if (maturityDate) {
      sql += ' AND DATE(t.maturity_date) = DATE(?)';
      params.push(maturityDate);
    }
    if (asAtDate) {
      sql += ' AND DATE(t.value_date) <= DATE(?)';
      params.push(asAtDate);
      sql += ' AND DATE(t.maturity_date) > DATE(?)';
      params.push(asAtDate);
    }

    sql += ' ORDER BY t.isin_number, t.maturity_date, t.id';

    const [rows] = await db.query(sql, params);

    const dealNumbers = rows.map((r) => (r.deal_number || '').trim()).filter(Boolean);
    const soldByDeal = {};

    if (dealNumbers.length) {
      const placeholders = dealNumbers.map(() => '?').join(',');
      let sellRefSql = `
        SELECT TRIM(buy_deal_number) AS buy_deal_number, COALESCE(SUM(face_value), 0) AS total_sold
        FROM tbill
        WHERE transaction_type = 'Sell'
          AND status != 'rejected'
          AND buy_deal_number IS NOT NULL
          AND TRIM(buy_deal_number) IN (${placeholders})
      `;
      const sellRefParams = [...dealNumbers];
      if (asAtDate) {
        sellRefSql += ' AND DATE(value_date) <= DATE(?)';
        sellRefParams.push(asAtDate);
      }
      sellRefSql += ' GROUP BY TRIM(buy_deal_number)';
      const [sellRefRows] = await db.query(sellRefSql, sellRefParams);
      sellRefRows.forEach((r) => {
        const key = (r.buy_deal_number || '').trim();
        soldByDeal[key] = Number(r.total_sold) || 0;
      });
    }

    // FIFO fallback for unlinked sells
    if (rows.length) {
      const uniqueIsins = [...new Set(rows.map((r) => r.isin_number).filter(Boolean))];
      if (uniqueIsins.length) {
        const ph = uniqueIsins.map(() => '?').join(',');
        let sellAllocSql = `
          SELECT id, portfolio_id, isin_number AS isin, face_value,
                 TRIM(buy_deal_number) AS buy_deal_number, value_date
          FROM tbill
          WHERE transaction_type = 'Sell' AND status != 'rejected' AND isin_number IN (${ph})
        `;
        const sellAllocParams = [...uniqueIsins];
        if (portfolio) {
          sellAllocSql += ' AND portfolio_id = ?';
          sellAllocParams.push(String(portfolio));
        }
        if (asAtDate) {
          sellAllocSql += ' AND DATE(value_date) <= DATE(?)';
          sellAllocParams.push(asAtDate);
        }
        sellAllocSql += ' ORDER BY DATE(value_date), id';
        const [sellAllocRows] = await db.query(sellAllocSql, sellAllocParams);

        const buyDealsByKey = {};
        rows.forEach((b) => {
          const dealNo = (b.deal_number || '').trim();
          if (!dealNo || !b.isin_number) return;
          const key = `${String(b.portfolio_id || '').trim()}|${String(b.isin_number).trim()}`;
          if (!buyDealsByKey[key]) buyDealsByKey[key] = [];
          buyDealsByKey[key].push({
            deal_number: dealNo,
            face_value: Number(b.face_value) || 0,
            value_date: b.value_date,
            id: Number(b.id) || 0
          });
        });
        Object.keys(buyDealsByKey).forEach((key) => {
          buyDealsByKey[key].sort((a, b) => {
            const ad = a.value_date ? String(a.value_date) : '';
            const bd = b.value_date ? String(b.value_date) : '';
            if (ad !== bd) return ad.localeCompare(bd);
            return (a.id || 0) - (b.id || 0);
          });
        });

        const buyDealSet = new Set(dealNumbers.map((d) => d.trim()));

        for (const s of sellAllocRows) {
          const linkedDeal = (s.buy_deal_number || '').trim();
          if (linkedDeal && buyDealSet.has(linkedDeal)) continue;

          const sellKey = `${String(s.portfolio_id || '').trim()}|${String(s.isin || '').trim()}`;
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

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const normalizedDealNumber = (row.deal_number || '').trim();
      const soldAgainstThisDeal = Number(soldByDeal[normalizedDealNumber] || 0);
      const originalFace = Number(row.face_value) || 0;
      row._direct_sold_against_deal = soldAgainstThisDeal;
      row.remaining_face_value_report = Math.max(0, originalFace - soldAgainstThisDeal);
      row.effective_remaining_face = resolveEffectiveRemainingFace(row);
    }

    const asAtYmd = asAtDate ? clampToYmd(asAtDate) : null;
    const effectiveAsAt = asAtDate || new Date().toISOString().split('T')[0];

    const visibleRows = rows.filter((row) => {
      if (Number(row.effective_remaining_face ?? 0) <= 0) return false;
      if (asAtYmd) {
        const matYmd = clampToYmd(row.maturity_date);
        if (matYmd && matYmd <= asAtYmd) return false;
      } else if (Number(row.matured) === 1) {
        return false;
      }
      return true;
    });

    const data = visibleRows.map((row) => {
      const originalFace = Number(row.face_value) || 0;
      const remainingFace = Number(row.effective_remaining_face ?? originalFace) || 0;
      const scale = originalFace > 0 ? remainingFace / originalFace : 1;
      const originalSettlement = Number(row.settlement_amount) || 0;
      const settlementOnRemaining = originalSettlement * scale;

      const maturityDateObj = safeParseISO(row.maturity_date);
      const asAtDateObj = safeParseISO(effectiveAsAt);
      let dtm = '';
      if (maturityDateObj && asAtDateObj) {
        dtm = Math.max(0, differenceInDays(maturityDateObj, asAtDateObj));
      }

      const remainingFormatted = formatCurrency(remainingFace, 2);
      const accrual = heldFaceAccrual(row, remainingFace, clampToYmd(effectiveAsAt));

      return {
        id: row.id,
        product_type: 'T-Bill',
        deal_number: row.deal_number || '',
        trade_date: row.trade_date,
        value_date: row.value_date,
        transaction_type: row.transaction_type || 'Buy',
        counterparty: row.counterparty_name || (row.counterparty ? String(row.counterparty) : ''),
        isin_number: row.isin_number || '',
        maturity_date: row.maturity_date,
        face_value: remainingFormatted,
        discount_rate_pct: formatPercentage(row.discount_rate_pct, 2),
        days_to_maturity: dtm !== '' ? String(dtm) : '',
        price_per_100: formatPrice(row.price_per_100, 2),
        settlement_amount: formatCurrency(settlementOnRemaining, 2),
        portfolio: resolvePortfolioDisplay(row),
        buy_deal_number: '',
        remaining_face_value: remainingFormatted,
        per_day_accrual: formatPrice(accrual.perDay, 2),
        accrued_interest_to_date: formatPrice(accrual.accrued, 2)
      };
    });

    let totalPortfolioBalance = null;
    if (portfolio) {
      let totalCents = 0;
      visibleRows.forEach((row) => {
        totalCents += Math.round((Number(row.effective_remaining_face ?? row.face_value) || 0) * 100);
      });
      totalPortfolioBalance = formatCurrency(totalCents / 100, 2);
    }

    const total = data.length;
    let paginatedData = data;
    if (page && pageSize) {
      const pageSizeNum = parseInt(pageSize, 10);
      const pageNum = parseInt(page, 10);
      const offset = (pageNum - 1) * pageSizeNum;
      paginatedData = data.slice(offset, offset + pageSizeNum);
    }

    return { data: paginatedData, total, totalPortfolioBalance };
  } catch (error) {
    console.error('[T-Bill Report Service] Error:', error);
    throw error;
  }
};
