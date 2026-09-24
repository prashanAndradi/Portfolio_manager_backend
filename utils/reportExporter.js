const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { parseISO, format: formatDateFns } = require('date-fns');

function formatDate(val) {
  if (!val) return '';
  try {
    const dateObj = typeof val === 'string' ? parseISO(val) : val;
    return formatDateFns(dateObj, 'dd-MMM-yyyy');
  } catch {
    return String(val).split('T')[0];
  }
}

const EXPORT_COLUMNS = [
  { key: 'product_type', label: 'Product Type' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'custodian', label: 'Custodian' },
  { key: 'deal_number', label: 'Deal Number' },
  { key: 'face_value', label: 'Face Value' },
  { key: 'issue_date', label: 'Issue Date' },
  { key: 'value_date', label: 'Value Date' },
  { key: 'last_coupon_date', label: 'Last Coupon Date' },
  { key: 'next_coupon_date', label: 'Next Coupon Date' },
  { key: 'maturity_date', label: 'Maturity Date' },
  { key: 'isin', label: 'ISIN' },
  { key: 'coupon_rate', label: 'Coupon Rate' },
  { key: 'coupon_interest', label: 'Coupon Interest' },
  { key: 'clean_price', label: 'Clean Price' },
  { key: 'dirty_price', label: 'Dirty Price' },
  { key: 'clean_price_amount', label: 'Clean Price Amount' },
  { key: 'dirty_price_amount', label: 'Dirty Price Amount' },
  { key: 'nvp', label: 'NVP' },
  { key: 'yield', label: 'Yield' },
  { key: 'dtm', label: 'DTM' },
  { key: 'balance', label: 'Balance' },
  { key: 'available_balance', label: 'Available Balance' },
  { key: 'daily_accrual', label: 'Daily Accrual' },
  { key: 'daily_amortization', label: 'Daily Amortization' },
  { key: 'cumulative_accrual', label: 'Cumulative Accrual' },
  { key: 'cumulative_amortization', label: 'Cumulative Amortization' },
  { key: 'wap', label: 'WAP' },
  { key: 'repo_collateral', label: 'Repo Collateral' },
  { key: 'sell_back', label: 'Sell Back' },
  { key: 'counterparty', label: 'Counterparty' },
  { key: 'transaction_type', label: 'Transaction Type' }
];

// ISIN-wise summary columns (GSec summary section)
const GSEC_SUMMARY_COLUMNS = [
  { key: 'isin', label: 'ISIN' },
  { key: 'maturity_date', label: 'Maturity Date' },
  { key: 'total_face_value', label: 'Total Face Value' },
  { key: 'weighted_avg_price', label: 'Weighted Average Price' },
  { key: 'weighted_yield', label: 'Weighted Yield' },
  { key: 'deal_count', label: 'Deals' }
];

/** Append a Total row summing total_face_value for ISIN-wise summary exports. */
function withGsecSummaryFaceTotal(summary) {
  const rows = Array.isArray(summary) ? [...summary] : [];
  if (!rows.length) return rows;
  const faceTotal = rows.reduce((sum, row) => {
    const n = Number(String(row.total_face_value ?? '').replace(/,/g, ''));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  rows.push({
    isin: 'Total',
    maturity_date: '',
    total_face_value: faceTotal.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }),
    weighted_avg_price: '',
    weighted_yield: '',
    deal_count: ''
  });
  return rows;
}

// GSec PDF download only — compact layout with ISIN-wise face-value subtotals
const GSEC_PDF_COLUMNS = [
  { key: 'isin', label: 'ISIN', width: 175, align: 'left' },
  { key: 'yield', label: 'Yield', width: 75, align: 'right' },
  { key: 'value_date', label: 'Value Date', width: 95, align: 'center' },
  { key: 'maturity_date', label: 'Maturity Date', width: 95, align: 'center' },
  { key: 'face_value', label: 'Face Value', width: 115, align: 'right' },
  { key: 'coupon_rate', label: 'Coupon Rate', width: 90, align: 'right' }
];

// Columns for Portfolio report exports – mirror the on-screen Portfolio report
const PORTFOLIO_EXPORT_COLUMNS = [
  { key: 'product_type', label: 'Product Type' },
  { key: 'deal_number', label: 'Deal Number' },
  { key: 'value_date', label: 'Value Date' },
  { key: 'trade_date', label: 'Trade Date' },
  { key: 'isin', label: 'ISIN' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'counterparty', label: 'Counterparty' },
  { key: 'transaction_type', label: 'Transaction Type' },
  { key: 'face_value', label: 'Face Value' },
  { key: 'clean_price', label: 'Clean Price' },
  { key: 'dirty_price', label: 'Dirty Price' },
  { key: 'settlement_amount', label: 'Settlement Amount' },
  { key: 'maturity_amount', label: 'Maturity Amount' },
  { key: 'amount', label: 'Amount' },
  { key: 'maturity_date', label: 'Maturity Date' },
  { key: 'status', label: 'Status' },
  { key: 'currency', label: 'Currency' }
];

const PORTFOLIO_OUTSTANDING_COLUMNS = [
  { key: 'product_type', label: 'Product' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'deal_number', label: 'Deal Number' },
  { key: 'isin', label: 'ISIN' },
  { key: 'value_date', label: 'Value Date' },
  { key: 'maturity_date', label: 'Maturity Date' },
  { key: 'coupon_rate', label: 'Coupon' },
  { key: 'yield', label: 'P.Yield' },
  { key: 'clean_price', label: 'C.Price' },
  { key: 'dtm', label: 'Dtm' },
  { key: 'balance_amt', label: 'Balance' }
];

const PORTFOLIO_SUMMARY_COLUMNS = [
  { key: 'isin', label: 'ISIN' },
  { key: 'yield', label: 'P.Yield' },
  { key: 'value_date', label: 'Value Date' },
  { key: 'maturity_date', label: 'Maturity Date' },
  { key: 'coupon_rate', label: 'Coupon' },
  { key: 'clean_price', label: 'C.Price' },
  { key: 'dtm', label: 'Dtm' },
  { key: 'balance_amt', label: 'Balance' },
  { key: 'sub_total', label: 'Sub Total' },
  { key: 'repo_quar', label: 'Repo Quar' }
];

// Buyback AST report export columns (one row per deal)
const BUYBACK_EXPORT_COLUMNS = [
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'counterparty', label: 'Counterparty' },
  { key: 'deal_number', label: 'Deal Number' },
  { key: 'transaction_type', label: 'Transaction Type' },
  { key: 'isin', label: 'ISIN' },
  { key: 'face_value', label: 'Face Value' },
  { key: 'leg1_clean_price', label: 'Leg1 Clean Price' },
  { key: 'leg1_dirty_price', label: 'Leg1 Dirty Price' },
  { key: 'leg1_clean_price_amount', label: 'Leg1 Clean Price Amount' },
  { key: 'value_date', label: 'Value Date (1st Leg)' },
  { key: 'maturity_date', label: 'Maturity Date (2nd Leg)' },
  { key: 'settlement_value', label: 'Settlement Value' },
  { key: 'maturity_value', label: 'Maturity Value' },
  { key: 'leg2_clean_price', label: 'Leg2 Clean Price' },
  { key: 'leg2_dirty_price', label: 'Leg2 Dirty Price' },
  { key: 'leg2_clean_price_amount', label: 'Leg2 Clean Price Amount' },
  { key: 'rate', label: 'Rate' },
  { key: 'dtm', label: 'DTM' }
];

// Repo + Reverse Repo report export columns
const REPO_EXPORT_COLUMNS = [
  { key: 'deal_number', label: 'Deal Number' },
  { key: 'deal_type', label: 'Deal Type' },
  { key: 'counterparty', label: 'Counterparty' },
  { key: 'settlement_mode', label: 'Settlement Mode' },
  { key: 'trade_date', label: 'Trade Date' },
  { key: 'value_date', label: 'Value Date' },
  { key: 'maturity_date', label: 'Maturity Date' },
  { key: 'principal_amount', label: 'Principal Amount' },
  { key: 'rate', label: 'Rate (%)' },
  { key: 'tenor', label: 'Tenor (Days)' },
  { key: 'interest_amount', label: 'Interest Amount' },
  { key: 'maturity_amount', label: 'Maturity Amount' },
  { key: 'isin', label: 'ISIN number' },
  { key: 'face_value_as_per_counterparty', label: 'Face value as per counterparty' }
];

// T-Bill report export columns
const TBILL_EXPORT_COLUMNS = [
  { key: 'trade_date', label: 'Trade Date' },
  { key: 'value_date', label: 'Value Date' },
  { key: 'transaction_type', label: 'Transaction' },
  { key: 'counterparty', label: 'Counterparty' },
  { key: 'isin_number', label: 'ISIN Number' },
  { key: 'maturity_date', label: 'Maturity Date' },
  { key: 'face_value', label: 'Face Value' },
  { key: 'discount_rate_pct', label: 'Discount Rate (%)' },
  { key: 'days_to_maturity', label: 'Days to Maturity' },
  { key: 'price_per_100', label: 'Price per 100' },
  { key: 'settlement_amount', label: 'Settlement Amount' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'remaining_face_value', label: 'Remaining Face Value' },
  { key: 'per_day_accrual', label: 'Per Day Accrual' },
  { key: 'accrued_interest_to_date', label: 'Accrued Interest to Date' },
  { key: 'deal_number', label: 'Deal Number' }
];

const TBILL_TRANSACTIONS_EXPORT_COLUMNS = [
  { key: 'deal_number', label: 'Deal Number' },
  { key: 'transaction_type', label: 'Transaction' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'counterparty', label: 'Counterparty' },
  { key: 'isin_number', label: 'ISIN Number' },
  { key: 'trade_date', label: 'Trade Date' },
  { key: 'value_date', label: 'Value Date' },
  { key: 'maturity_date', label: 'Maturity Date' },
  { key: 'face_value', label: 'Face Value' },
  { key: 'discount_rate_pct', label: 'Discount Rate (%)' },
  { key: 'price_per_100', label: 'Price per 100' },
  { key: 'settlement_amount', label: 'Settlement Amount' },
  { key: 'status', label: 'Status' }
];

const GSEC_TRANSACTIONS_EXPORT_COLUMNS = [
  { key: 'deal_number', label: 'Deal Number' },
  { key: 'transaction_type', label: 'Transaction Type' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'counterparty', label: 'Counterparty' },
  { key: 'isin', label: 'ISIN' },
  { key: 'trade_date', label: 'Trade Date' },
  { key: 'value_date', label: 'Value Date' },
  { key: 'maturity_date', label: 'Maturity Date' },
  { key: 'face_value', label: 'Face Value' },
  { key: 'clean_price', label: 'Clean Price' },
  { key: 'dirty_price', label: 'Dirty Price' },
  { key: 'yield', label: 'Yield' },
  { key: 'settlement_amount', label: 'Settlement Amount' },
  { key: 'coupon_rate', label: 'Coupon Rate' },
  { key: 'status', label: 'Status' }
];

// Daily Maturity Handling screen — matches on-screen table columns
const MATURITY_CASHFLOW_EXPORT_COLUMNS = [
  { key: 'event_type', label: 'Event' },
  { key: 'cash_flow', label: 'Cash Flow' },
  { key: 'instrument', label: 'Instrument' },
  { key: 'description', label: 'Description' },
  { key: 'deal_number', label: 'Ref. No.' },
  { key: 'reference_deal_number', label: 'Reference Deal' },
  { key: 'settlement_value', label: 'Settlement Value' },
  { key: 'val_mat', label: 'Val/Mat' },
  { key: 'status', label: 'Status' },
  { key: 'value_date', label: 'Val Date' },
  { key: 'opening_balance', label: 'Opening Balance' }
];

/** Parse numbers that may include thousand separators (e.g. API-formatted strings). */
function parseLocaleNumber(val) {
  if (val === undefined || val === null || val === '') return NaN;
  if (typeof val === 'number') return Number.isFinite(val) ? val : NaN;
  const s = String(val).trim().replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Quantize to 4 decimal places for display/export.
 * Math.trunc(n * 10000) mis-handles values like 93.8046 (IEEE-754 → 93.8045).
 */
function quantizeTo4Decimals(val) {
  if (val === undefined || val === null || val === '') return NaN;
  if (typeof val === 'string') {
    const s = val.trim().replace(/,/g, '');
    if (!s) return NaN;
    const m = s.match(/^(-?\d+)(?:\.(\d+))?$/);
    if (m) {
      const frac = (m[2] || '').padEnd(4, '0').slice(0, 4);
      return Number(`${m[1]}.${frac}`);
    }
  }
  const n = typeof val === 'number' ? val : parseLocaleNumber(val);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 10000 + Number.EPSILON) / 10000;
}

function formatNumber4(val) {
  if (val === undefined || val === null || val === '') return '';
  const q = quantizeTo4Decimals(val);
  if (isNaN(q)) return val !== undefined && val !== null ? String(val) : '';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  }).format(q);
}

function toExcelNumber4(val) {
  const q = quantizeTo4Decimals(val);
  return isNaN(q) ? null : q;
}

function formatNumber2(val) {
  if (val === undefined || val === null || val === '') return '';
  const n = parseLocaleNumber(val);
  if (isNaN(n)) return val;
  // Truncate (not round) to 2 decimals
  const truncated = Math.trunc(n * 100) / 100;
  // Format with comma separators and exactly 2 decimal places
  return new Intl.NumberFormat('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  }).format(truncated);
}

function toExcelNumber(val) {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const s = String(val).trim();
  if (!s) return null;
  const normalized = s.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function preprocessExportData(data) {
  // Fallback WAP per ISIN (comma-safe) when row.wap is missing
  const isinMap = {};
  data.forEach(row => {
    const isin = row.isin;
    const fv = parseLocaleNumber(row.face_value);
    const cp = parseLocaleNumber(row.clean_price);
    const fvNum = isNaN(fv) ? 0 : fv;
    const cpNum = isNaN(cp) ? 0 : cp;
    if (!isinMap[isin]) {
      isinMap[isin] = { sumFV: 0, sumFVCP: 0 };
    }
    isinMap[isin].sumFV += fvNum;
    isinMap[isin].sumFVCP += fvNum * cpNum;
  });

  return data.map(row => {
    const mapped = {};
    EXPORT_COLUMNS.forEach(col => {
      let val = row[col.key];
      if (col.key === 'value_date' || col.key === 'maturity_date' ||
          col.key === 'issue_date' || col.key === 'last_coupon_date' ||
          col.key === 'next_coupon_date') {
        val = formatDate(val);
      }
      // 4 decimal places (prices / rates as returned by GSEC report API)
      if ([
        'coupon_rate',
        'coupon_interest',
        'yield',
        'balance',
        'available_balance',
        'clean_price',
        'dirty_price',
        'nvp',
        'repo_collateral'
      ].includes(col.key)) {
        val = formatNumber4(val);
      }
      // Currency-style 2 decimals
      if (col.key === 'face_value' || col.key === 'sell_back' ||
          col.key === 'clean_price_amount' || col.key === 'dirty_price_amount') {
        val = formatNumber2(val);
      }
      // DTM: integer days (handle locale-formatted integers)
      if (col.key === 'dtm') {
        const n = parseLocaleNumber(val);
        val = isNaN(n) ? val : Math.trunc(n).toString();
      }
      // Prefer API WAP (already ISIN-weighted); fallback to recomputed map
      if (col.key === 'wap') {
        const fromApi = parseLocaleNumber(row.wap);
        if (!isNaN(fromApi) && row.wap !== undefined && row.wap !== null && row.wap !== '') {
          val = formatNumber4(fromApi);
        } else {
          const m = isinMap[row.isin];
          const wapFallback = m && m.sumFV ? m.sumFVCP / m.sumFV : 0;
          val = formatNumber4(wapFallback);
        }
      }
      mapped[col.key] = val !== undefined && val !== null ? val : '';
    });
    return mapped;
  });
}

/** Build PDF-only rows: deals sorted lowest→highest yield, then ISIN and grand face-value subtotals. */
function buildGsecPdfTableRows(rawData, processedData) {
  const paired = (rawData || []).map((raw, i) => ({
    raw,
    row: processedData[i] || {}
  }));
  paired.sort((a, b) => {
    const ay = parseLocaleNumber(a.raw && a.raw.yield);
    const by = parseLocaleNumber(b.raw && b.raw.yield);
    const aMissing = !Number.isFinite(ay);
    const bMissing = !Number.isFinite(by);
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (!aMissing && ay !== by) return ay - by;
    const ai = String(a.row.isin || '');
    const bi = String(b.row.isin || '');
    if (ai !== bi) return ai.localeCompare(bi);
    return String(a.row.value_date || '').localeCompare(String(b.row.value_date || ''));
  });

  const result = [];
  const isinSums = {};

  const pushSubtotal = (isin, sum, isGrand = false) => {
    result.push({
      _isSubtotal: true,
      _isGrandTotal: isGrand,
      isin: isGrand ? 'Grand Total' : `Subtotal — ${isin}`,
      yield: '',
      value_date: '',
      maturity_date: '',
      face_value: formatNumber2(sum),
      coupon_rate: ''
    });
  };

  let grandTotal = 0;
  for (const { raw, row } of paired) {
    const isin = row.isin || '';
    const fv = parseLocaleNumber(raw.face_value);
    const amount = Number.isFinite(fv) ? fv : (Number(raw.face_value) || 0);
    if (isin) isinSums[isin] = (isinSums[isin] || 0) + amount;
    grandTotal += amount;
    result.push({ ...row, _isSubtotal: false, _isGrandTotal: false });
  }

  Object.keys(isinSums)
    .sort((a, b) => a.localeCompare(b))
    .forEach((isin) => pushSubtotal(isin, isinSums[isin]));

  pushSubtotal('', grandTotal, true);

  return result;
}

function scalePdfColumnsToPage(columns, doc) {
  const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totalWidth = columns.reduce((sum, col) => sum + col.width, 0);
  if (totalWidth <= 0) return columns;
  const scale = maxWidth / totalWidth;
  columns.forEach(col => { col.width = Math.floor(col.width * scale); });
  const used = columns.reduce((sum, col) => sum + col.width, 0);
  const remainder = maxWidth - used;
  if (remainder !== 0) columns[columns.length - 1].width += remainder;
  return columns;
}

function drawPdfColumnGrid(doc, x, y, columns, height, stroke = '#d1d5db') {
  let cx = x;
  doc.save();
  doc.lineWidth(0.5);
  doc.strokeColor(stroke);
  columns.forEach((col, idx) => {
    if (idx > 0) {
      doc.moveTo(cx, y).lineTo(cx, y + height).stroke();
    }
    cx += col.width;
  });
  doc.restore();
}

// Pre-processing specifically for Portfolio report exports
function preprocessPortfolioExportData(data) {
  return data.map(row => {
    const mapped = {};

    PORTFOLIO_EXPORT_COLUMNS.forEach(col => {
      let val = row[col.key];

      // Date fields - check if already formatted (contains dashes in DD-MM-YYYY format)
      if (['value_date', 'trade_date', 'maturity_date'].includes(col.key)) {
        // If already formatted as string (DD-MM-YYYY), use as-is, otherwise format
        if (val && typeof val === 'string' && val.match(/^\d{2}-\d{2}-\d{4}$/)) {
          // Already formatted, use as-is
        } else {
          val = formatDate(val);
        }
      }

      // Numeric fields - check if already formatted (contains commas)
      if (
        ['face_value', 'clean_price', 'dirty_price', 'settlement_amount', 'maturity_amount', 'amount'].includes(col.key)
      ) {
        // If already formatted with commas, use as-is, otherwise format
        if (val && typeof val === 'string' && val.includes(',')) {
          // Already formatted, use as-is
        } else {
          val = formatNumber2(val);
        }
      }

      mapped[col.key] = val !== undefined && val !== null ? val : '';
    });

    return mapped;
  });
}

function preprocessBuybackExportData(data) {
  return (data || []).map(row => {
    const mapped = {};

    BUYBACK_EXPORT_COLUMNS.forEach(col => {
      let val = row[col.key];

      if (['value_date', 'maturity_date'].includes(col.key)) {
        val = formatDate(val);
      }

      if (['face_value', 'settlement_value', 'maturity_value',
           'leg1_clean_price_amount', 'leg2_clean_price_amount'].includes(col.key)) {
        val = formatNumber2(val);
      }

      if (['rate', 'leg1_clean_price', 'leg1_dirty_price',
           'leg2_clean_price', 'leg2_dirty_price'].includes(col.key)) {
        val = formatNumber4(val);
      }

      if (col.key === 'dtm') {
        const n = parseLocaleNumber(val);
        val = isNaN(n) ? val : Math.trunc(n).toString();
      }

      mapped[col.key] = val !== undefined && val !== null ? val : '';
    });

    return mapped;
  });
}

function preprocessRepoExportData(data) {
  return (data || []).map(row => {
    const mapped = {};
    REPO_EXPORT_COLUMNS.forEach(col => {
      let val = row[col.key];
      if (['trade_date', 'value_date', 'maturity_date'].includes(col.key)) {
        val = formatDate(val);
      }
      mapped[col.key] = val !== undefined && val !== null ? val : '';
    });
    return mapped;
  });
}

exports.export = async (format, data, summary = []) => {
  // Always format dates for export
  const processedData = preprocessExportData(data);
  const summaryRows = withGsecSummaryFaceTotal(summary);

  if (format === 'csv') {
    const parser = new Parser({ fields: EXPORT_COLUMNS.map(col => ({ label: col.label, value: col.key })) });
    let csv = parser.parse(processedData);
    if (summaryRows.length) {
      const summaryParser = new Parser({
        fields: GSEC_SUMMARY_COLUMNS.map(col => ({ label: col.label, value: col.key }))
      });
      const summaryCsv = summaryParser.parse(summaryRows);
      csv = `${csv}\n\n"ISIN-wise Summary"\n${summaryCsv}`;
    }
    return csv;
  }
  if (format === 'excel') {
    const numeric2dpKeys = new Set(['face_value', 'sell_back', 'clean_price_amount', 'dirty_price_amount']);
    const numeric4dpKeys = new Set([
      'coupon_rate',
      'coupon_interest',
      'yield',
      'balance',
      'available_balance',
      'daily_accrual',
      'daily_amortization',
      'cumulative_accrual',
      'cumulative_amortization',
      'clean_price',
      'dirty_price',
      'nvp',
      'wap',
      'repo_collateral'
    ]);
    const intKeys = new Set(['dtm']);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('GSec Report');
    sheet.columns = EXPORT_COLUMNS.map(col => ({ header: col.label, key: col.key }));

    const excelRows = processedData.map(row => {
      const next = { ...row };
      for (const k of numeric2dpKeys) next[k] = toExcelNumber(next[k]);
      for (const k of numeric4dpKeys) next[k] = toExcelNumber4(next[k]);
      for (const k of intKeys) {
        const n = toExcelNumber(next[k]);
        next[k] = n === null ? null : Math.trunc(n);
      }
      return next;
    });

    sheet.addRows(excelRows);

    // Apply number formats so values remain numeric (AutoSum works) but display nicely
    for (const k of numeric2dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.00';
    }
    for (const k of numeric4dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.0000';
    }
    for (const k of intKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '0';
    }

    // ISIN-wise summary on its own worksheet
    if (summaryRows.length) {
      const summarySheet = workbook.addWorksheet('ISIN Summary');
      summarySheet.columns = GSEC_SUMMARY_COLUMNS.map(col => ({ header: col.label, key: col.key }));
      const summaryNumeric2dp = new Set(['total_face_value']);
      const summaryNumeric4dp = new Set(['weighted_avg_price', 'weighted_yield']);
      const summaryInt = new Set(['deal_count']);
      const summaryExcelRows = summaryRows.map(row => {
        const next = { ...row };
        for (const k of summaryNumeric2dp) next[k] = toExcelNumber(next[k]);
        for (const k of summaryNumeric4dp) next[k] = toExcelNumber4(next[k]);
        for (const k of summaryInt) {
          const n = toExcelNumber(next[k]);
          next[k] = n === null ? null : Math.trunc(n);
        }
        return next;
      });
      summarySheet.addRows(summaryExcelRows);
      if (summaryExcelRows.length > 0) {
        const totalRow = summarySheet.getRow(summaryExcelRows.length + 1);
        totalRow.font = { bold: true };
      }
      for (const k of summaryNumeric2dp) {
        const col = summarySheet.getColumn(k);
        if (col) col.numFmt = '#,##0.00';
      }
      for (const k of summaryNumeric4dp) {
        const col = summarySheet.getColumn(k);
        if (col) col.numFmt = '#,##0.0000';
      }
      for (const k of summaryInt) {
        const col = summarySheet.getColumn(k);
        if (col) col.numFmt = '0';
      }
    }

    return workbook.xlsx.writeBuffer();
  }
  if (format === 'pdf') {
    const pdfMargin = 16;
    const doc = new PDFDocument({ margin: pdfMargin, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {});

    const titleY = doc.page.margins.top;
    doc.fontSize(12).font('Helvetica-Bold').text('GSec Product Report', doc.page.margins.left, titleY, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: 'center',
      lineBreak: false
    });
    doc.fontSize(7).font('Helvetica').fillColor('#555555').text(
      `Generated: ${formatDateFns(new Date(), 'dd-MMM-yyyy')}  |  Records: ${data.length}`,
      doc.page.margins.left,
      titleY + 14,
      {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'center',
        lineBreak: false
      }
    );
    doc.fillColor('#000000');

    const pdfRows = buildGsecPdfTableRows(data, processedData);
    const columns = scalePdfColumnsToPage(GSEC_PDF_COLUMNS.map(c => ({ ...c })), doc);
    const headerRowH = 15;
    const dataRowH = 13;
    const subtotalRowH = 14;
    const cellPadX = 3;
    const startX = doc.page.margins.left;
    const tableWidth = columns.reduce((a, c) => a + c.width, 0);
    const pageBottom = () => doc.page.height - doc.page.margins.bottom;

    const textY = (rowY, rowH, fontSize) => rowY + Math.max(2, (rowH - fontSize) / 2 - 1);

    function drawTableHeader(y) {
      doc.rect(startX, y, tableWidth, headerRowH).fillAndStroke('#2c5282', '#2c5282');
      doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold');
      let x = startX;
      columns.forEach(col => {
        doc.text(col.label, x + cellPadX, textY(y, headerRowH, 7), {
          width: col.width - 2 * cellPadX,
          align: col.align || 'left',
          lineBreak: false
        });
        x += col.width;
      });
      drawPdfColumnGrid(doc, startX, y, columns, headerRowH, '#4a6fa5');
      doc.fillColor('#000000');
      return y + headerRowH;
    }

    function drawPdfRows(startY) {
      let currentY = startY;
      let detailIndex = 0;

      for (const row of pdfRows) {
        const isSubtotal = row._isSubtotal;
        const isGrand = row._isGrandTotal;
        const h = isSubtotal ? subtotalRowH : dataRowH;

        if (currentY + h > pageBottom()) {
          doc.addPage();
          currentY = drawTableHeader(doc.page.margins.top + 4);
        }

        if (isGrand) {
          doc.rect(startX, currentY, tableWidth, h).fillAndStroke('#d9e2ef', '#2c5282');
          doc.font('Helvetica-Bold').fontSize(7).fillColor('#1a365d');
        } else if (isSubtotal) {
          doc.rect(startX, currentY, tableWidth, h).fillAndStroke('#edf2f7', '#a0aec0');
          doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#2d3748');
        } else {
          if (detailIndex % 2 === 1) {
            doc.rect(startX, currentY, tableWidth, h).fill('#f8fafc');
          }
          doc.font('Helvetica').fontSize(6.5).fillColor('#000000');
        }

        const fontSize = isSubtotal || isGrand ? (isGrand ? 7 : 6.5) : 6.5;
        let x = startX;
        columns.forEach(col => {
          const val = row[col.key] !== undefined && row[col.key] !== null ? String(row[col.key]) : '';
          doc.text(val, x + cellPadX, textY(currentY, h, fontSize), {
            width: col.width - 2 * cellPadX,
            align: col.align || 'left',
            lineBreak: false
          });
          x += col.width;
        });

        doc.rect(startX, currentY, tableWidth, h).stroke(isGrand ? '#2c5282' : '#cbd5e1');
        drawPdfColumnGrid(doc, startX, currentY, columns, h, '#e2e8f0');
        currentY += h;
        if (!isSubtotal) detailIndex += 1;
      }

      return currentY;
    }

    const headerY = drawTableHeader(titleY + 28);
    drawPdfRows(headerY);

    doc.end();
    return await new Promise(resolve => {
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
    });
  }
  throw new Error('Unsupported export format');
};

// GSec ISIN-wise summary report export (Excel/CSV/PDF) – summary only
exports.exportGsecSummary = async (format, summary) => {
  const summaryRows = withGsecSummaryFaceTotal(summary);

  if (format === 'csv') {
    const parser = new Parser({
      fields: GSEC_SUMMARY_COLUMNS.map(col => ({ label: col.label, value: col.key }))
    });
    return parser.parse(summaryRows);
  }

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('ISIN Summary');
    sheet.columns = GSEC_SUMMARY_COLUMNS.map(col => ({ header: col.label, key: col.key }));

    const numeric2dp = new Set(['total_face_value']);
    const numeric4dp = new Set(['weighted_avg_price', 'weighted_yield']);
    const intKeys = new Set(['deal_count']);

    const excelRows = summaryRows.map(row => {
      const next = { ...row };
      for (const k of numeric2dp) next[k] = toExcelNumber(next[k]);
      for (const k of numeric4dp) next[k] = toExcelNumber(next[k]);
      for (const k of intKeys) {
        const n = toExcelNumber(next[k]);
        next[k] = n === null ? null : Math.trunc(n);
      }
      return next;
    });

    sheet.addRows(excelRows);

    for (const k of numeric2dp) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.00';
    }
    for (const k of numeric4dp) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.0000';
    }
    for (const k of intKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '0';
    }

    // Bold the Total row
    if (excelRows.length > 0) {
      const totalRow = sheet.getRow(excelRows.length + 1); // +1 for header
      totalRow.font = { bold: true };
    }

    return workbook.xlsx.writeBuffer();
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {});

    doc.fontSize(20).font('Helvetica-Bold').text('GSec ISIN-wise Summary Report', { align: 'center' });
    doc.moveDown(1);

    const columns = [
      { key: 'isin', label: 'ISIN', width: 130, align: 'left' },
      { key: 'maturity_date', label: 'Maturity Date', width: 110, align: 'center' },
      { key: 'total_face_value', label: 'Total Face Value', width: 130, align: 'right' },
      { key: 'weighted_avg_price', label: 'Weighted Average Price', width: 140, align: 'right' },
      { key: 'weighted_yield', label: 'Weighted Yield', width: 110, align: 'right' },
      { key: 'deal_count', label: 'Deals', width: 60, align: 'right' }
    ];

    const rowHeight = 24;
    const cellPadding = 4;
    const startX = doc.page.margins.left;

    const drawHeader = (y) => {
      const w = columns.reduce((a, c) => a + c.width, 0);
      doc.rect(startX, y, w, rowHeight).fillAndStroke('#f0f0f0', '#000000');
      doc.fillColor('#000000').fontSize(10).font('Helvetica-Bold');
      let x = startX;
      columns.forEach(col => {
        doc.text(col.label, x + cellPadding, y + 7, { width: col.width - 2 * cellPadding, align: col.align });
        x += col.width;
      });
      return y + rowHeight;
    };

    let y = drawHeader(doc.y);
    summaryRows.forEach((row, index) => {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = drawHeader(doc.page.margins.top);
      }
      const w = columns.reduce((a, c) => a + c.width, 0);
      const isTotal = row.isin === 'Total';
      if (isTotal) doc.rect(startX, y, w, rowHeight).fill('#eef2f7');
      else if (index % 2 === 1) doc.rect(startX, y, w, rowHeight).fill('#f8f8f8');
      doc.font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#000000');
      let x = startX;
      columns.forEach(col => {
        const text = row[col.key] !== undefined && row[col.key] !== null ? String(row[col.key]) : '';
        doc.text(text, x + cellPadding, y + 7, { width: col.width - 2 * cellPadding, align: col.align });
        x += col.width;
      });
      doc.rect(startX, y, w, rowHeight).stroke(isTotal ? '#2c5282' : '#cccccc');
      y += rowHeight;
    });

    doc.end();
    return await new Promise(resolve => {
      doc.on('end', () => resolve(Buffer.concat(buffers)));
    });
  }

  throw new Error('Unsupported export format');
};

// Portfolio report export (Excel/CSV/PDF) – uses portfolio-specific columns
exports.exportPortfolio = async (format, data) => {
  // Debug: Log first row to see what fields are available
  if (data && data.length > 0) {
    console.log('Portfolio Export - First row fields:', Object.keys(data[0]));
    console.log('Portfolio Export - First row sample:', JSON.stringify(data[0], null, 2));
  }
  
  const processedData = preprocessPortfolioExportData(data);

  if (format === 'csv') {
    const parser = new Parser({
      fields: PORTFOLIO_EXPORT_COLUMNS.map(col => ({ label: col.label, value: col.key }))
    });
    return parser.parse(processedData);
  }

  if (format === 'excel') {
    const numeric2dpKeys = new Set([
      'face_value',
      'clean_price',
      'dirty_price',
      'settlement_amount',
      'maturity_amount',
      'amount'
    ]);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Portfolio Report');
    sheet.columns = PORTFOLIO_EXPORT_COLUMNS.map(col => ({
      header: col.label,
      key: col.key
    }));

    const excelRows = processedData.map(row => {
      const next = { ...row };
      for (const k of numeric2dpKeys) next[k] = toExcelNumber(next[k]);
      return next;
    });

    sheet.addRows(excelRows);

    for (const k of numeric2dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.00';
    }

    return workbook.xlsx.writeBuffer();
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {});

    // Title
    doc.fontSize(20).font('Helvetica-Bold').text('Portfolio Report', { align: 'center' });
    doc.moveDown(1);

    // Simple table layout reusing the same columns
    const columns = PORTFOLIO_EXPORT_COLUMNS.map(col => ({
      key: col.key,
      label: col.label,
      width: 70,
      align: ['face_value', 'clean_price', 'dirty_price', 'settlement_amount', 'maturity_amount', 'amount'].includes(col.key)
        ? 'right'
        : 'left'
    }));

    const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const totalWidth = columns.reduce((sum, col) => sum + col.width, 0);
    if (totalWidth > maxWidth) {
      const scale = maxWidth / totalWidth;
      columns.forEach(col => {
        col.width = Math.floor(col.width * scale);
      });
    }

    const rowHeight = 20;
    const cellPadding = 4;
    const startX = doc.page.margins.left;

    function drawHeader(y) {
      const headerWidth = columns.reduce((sum, col) => sum + col.width, 0);
      doc.rect(startX, y, headerWidth, rowHeight).fillAndStroke('#f0f0f0', '#000000');
      doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold');

      let x = startX;
      columns.forEach(col => {
        doc.text(col.label, x + cellPadding, y + 5, {
          width: col.width - 2 * cellPadding,
          align: col.align
        });
        x += col.width;
      });
      return y + rowHeight;
    }

    function drawRows(startY) {
      let y = startY;
      processedData.forEach((row, index) => {
        if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          y = drawHeader(doc.page.margins.top);
        }

        const rowWidth = columns.reduce((sum, col) => sum + col.width, 0);
        if (index % 2 === 1) {
          doc.rect(startX, y, rowWidth, rowHeight).fill('#f8f8f8');
        }

        doc.font('Helvetica').fontSize(8).fillColor('#000000');
        let x = startX;
        columns.forEach(col => {
          const text = row[col.key] !== undefined ? String(row[col.key]) : '';
          doc.text(text, x + cellPadding, y + 5, {
            width: col.width - 2 * cellPadding,
            align: col.align
          });
          x += col.width;
        });

        doc.rect(startX, y, rowWidth, rowHeight).stroke('#cccccc');
        y += rowHeight;
      });
    }

    const headerY = drawHeader(doc.page.margins.top);
    drawRows(headerY);

    doc.end();
    return await new Promise(resolve => {
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
    });
  }

  throw new Error('Unsupported export format');
};

function mapTabularExportRows(columns, rows, { dateKeys = [] } = {}) {
  return (rows || []).map((row) => {
    const mapped = { _type: row._type || 'deal' };
    columns.forEach((col) => {
      let val = row[col.key];
      if (dateKeys.includes(col.key) && val) {
        val = formatDate(val);
      }
      mapped[col.key] = val !== undefined && val !== null ? val : '';
    });
    return mapped;
  });
}

async function exportTabularReport(format, {
  title,
  sheetName,
  columns,
  rows,
  dateKeys = [],
  moneyKeys = [],
  rateKeys = []
}) {
  const processedData = mapTabularExportRows(columns, rows, { dateKeys });

  if (format === 'csv') {
    const parser = new Parser({
      fields: columns.map((col) => ({ label: col.label, value: col.key }))
    });
    return parser.parse(processedData);
  }

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = columns.map((col) => ({ header: col.label, key: col.key, width: 16 }));

    processedData.forEach((row) => {
      const excelRow = { ...row };
      moneyKeys.forEach((k) => { excelRow[k] = toExcelNumber(excelRow[k]); });
      rateKeys.forEach((k) => { excelRow[k] = toExcelNumber(excelRow[k]); });
      const added = sheet.addRow(excelRow);
      const type = row._type;
      if (type === 'section' || type === 'total' || type === 'subtotal') {
        added.font = { bold: true };
      }
      if (type === 'section') added.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      if (type === 'subtotal') added.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
      if (type === 'total') added.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    });

    moneyKeys.forEach((k) => {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.00';
    });
    rateKeys.forEach((k) => {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.0000';
    });

    return workbook.xlsx.writeBuffer();
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 24, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));

    doc.fontSize(16).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.moveDown(0.6);

    const moneySet = new Set(moneyKeys);
    const pdfColumns = columns.map((col) => ({
      key: col.key,
      label: col.label,
      width: 70,
      align: moneySet.has(col.key) || rateKeys.includes(col.key) || col.key === 'dtm' ? 'right' : 'left'
    }));

    const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const totalWidth = pdfColumns.reduce((sum, col) => sum + col.width, 0);
    if (totalWidth > maxWidth) {
      const scale = maxWidth / totalWidth;
      pdfColumns.forEach((col) => { col.width = Math.floor(col.width * scale); });
    }

    const rowHeight = 16;
    const cellPadding = 3;
    const startX = doc.page.margins.left;

    function drawHeader(y) {
      const headerWidth = pdfColumns.reduce((sum, col) => sum + col.width, 0);
      doc.rect(startX, y, headerWidth, rowHeight).fillAndStroke('#f0f0f0', '#000000');
      doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold');
      let x = startX;
      pdfColumns.forEach((col) => {
        doc.text(col.label, x + cellPadding, y + 4, {
          width: col.width - 2 * cellPadding,
          align: col.align
        });
        x += col.width;
      });
      return y + rowHeight;
    }

    let y = drawHeader(doc.y);
    processedData.forEach((row) => {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = drawHeader(doc.page.margins.top);
      }
      const rowWidth = pdfColumns.reduce((sum, col) => sum + col.width, 0);
      const type = row._type;
      if (type === 'section') doc.rect(startX, y, rowWidth, rowHeight).fill('#f3f4f6');
      else if (type === 'subtotal') doc.rect(startX, y, rowWidth, rowHeight).fill('#dbeafe');
      else if (type === 'total') doc.rect(startX, y, rowWidth, rowHeight).fill('#e5e7eb');

      doc.font(type === 'deal' ? 'Helvetica' : 'Helvetica-Bold').fontSize(7).fillColor('#000000');
      let x = startX;
      pdfColumns.forEach((col) => {
        const text = row[col.key] !== undefined ? String(row[col.key]) : '';
        doc.text(text, x + cellPadding, y + 4, {
          width: col.width - 2 * cellPadding,
          align: col.align
        });
        x += col.width;
      });
      doc.rect(startX, y, rowWidth, rowHeight).stroke('#cccccc');
      y += rowHeight;
    });

    doc.end();
    return await new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(buffers)));
    });
  }

  throw new Error('Unsupported export format');
}

exports.exportPortfolioOutstanding = async (format, data, totals = {}, asAtDate = '') => {
  const rows = [...(data || [])];
  if (totals && totals.balance_amt) {
    rows.push({
      _type: 'total',
      product_type: 'Total',
      balance_amt: totals.balance_amt
    });
  }
  const title = asAtDate
    ? `Outstanding Holdings as at ${formatDate(asAtDate)}`
    : 'Outstanding Holdings as at Date';
  return exportTabularReport(format, {
    title,
    sheetName: 'Outstanding',
    columns: PORTFOLIO_OUTSTANDING_COLUMNS,
    rows,
    dateKeys: ['value_date', 'maturity_date'],
    moneyKeys: ['balance_amt'],
    rateKeys: ['coupon_rate', 'yield', 'clean_price']
  });
};

exports.exportPortfolioSummary = async (format, data, totals = {}, asAtDate = '') => {
  const rows = [...(data || [])];
  if (totals && (totals.sub_total || totals.isin)) {
    rows.push({
      _type: 'total',
      isin: totals.isin || 'Grand Total',
      sub_total: totals.sub_total || '',
      repo_quar: totals.repo_quar || ''
    });
  }
  const title = asAtDate
    ? `Portfolio Summary as at ${formatDate(asAtDate)}`
    : 'Portfolio Summary as at Date';
  return exportTabularReport(format, {
    title,
    sheetName: 'Summary',
    columns: PORTFOLIO_SUMMARY_COLUMNS,
    rows,
    dateKeys: ['value_date', 'maturity_date'],
    moneyKeys: ['balance_amt', 'sub_total', 'repo_quar'],
    rateKeys: ['coupon_rate', 'yield', 'clean_price']
  });
};

// Buyback AST report export (Excel/CSV/PDF) – one row per deal
exports.exportBuyback = async (format, data) => {
  const processedData = preprocessBuybackExportData(data);

  if (format === 'csv') {
    const parser = new Parser({
      fields: BUYBACK_EXPORT_COLUMNS.map(col => ({ label: col.label, value: col.key }))
    });
    return parser.parse(processedData);
  }

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Buyback AST Report');
    sheet.columns = BUYBACK_EXPORT_COLUMNS.map(col => ({
      header: col.label,
      key: col.key
    }));

    const numeric2dpKeys = new Set(['face_value', 'settlement_value', 'maturity_value',
      'leg1_clean_price_amount', 'leg2_clean_price_amount']);
    const numeric4dpKeys = new Set(['rate', 'leg1_clean_price', 'leg1_dirty_price',
      'leg2_clean_price', 'leg2_dirty_price']);
    const intKeys = new Set(['dtm']);

    const excelRows = processedData.map(row => {
      const next = { ...row };
      for (const k of numeric2dpKeys) next[k] = toExcelNumber(next[k]);
      for (const k of numeric4dpKeys) next[k] = toExcelNumber4(next[k]);
      for (const k of intKeys) {
        const n = toExcelNumber(next[k]);
        next[k] = n === null ? null : Math.trunc(n);
      }
      return next;
    });

    sheet.addRows(excelRows);

    for (const k of numeric2dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.00';
    }
    for (const k of numeric4dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.0000';
    }
    for (const k of intKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '0';
    }

    return workbook.xlsx.writeBuffer();
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {});

    doc.fontSize(20).font('Helvetica-Bold').text('Buyback AST Report', { align: 'center' });
    doc.moveDown(1);

    const columns = BUYBACK_EXPORT_COLUMNS.map(col => ({
      key: col.key,
      label: col.label,
      width: ['portfolio', 'counterparty', 'deal_number', 'transaction_type', 'isin'].includes(col.key) ? 90 : 75,
      align: ['face_value', 'settlement_value', 'maturity_value', 'rate', 'dtm',
        'leg1_clean_price', 'leg1_dirty_price', 'leg1_clean_price_amount',
        'leg2_clean_price', 'leg2_dirty_price', 'leg2_clean_price_amount'].includes(col.key)
        ? 'right'
        : 'left'
    }));

    const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const totalWidth = columns.reduce((sum, col) => sum + col.width, 0);
    if (totalWidth > maxWidth) {
      const scale = maxWidth / totalWidth;
      columns.forEach(col => {
        col.width = Math.floor(col.width * scale);
      });
    }

    const rowHeight = 20;
    const cellPadding = 4;
    const startX = doc.page.margins.left;

    function drawHeader(y) {
      const headerWidth = columns.reduce((sum, col) => sum + col.width, 0);
      doc.rect(startX, y, headerWidth, rowHeight).fillAndStroke('#f0f0f0', '#000000');
      doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold');
      let x = startX;
      columns.forEach(col => {
        doc.text(col.label, x + cellPadding, y + 5, {
          width: col.width - 2 * cellPadding,
          align: col.align
        });
        x += col.width;
      });
      return y + rowHeight;
    }

    function drawRows(startY) {
      let y = startY;
      processedData.forEach((row, index) => {
        if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          y = drawHeader(doc.page.margins.top);
        }

        const rowWidth = columns.reduce((sum, col) => sum + col.width, 0);
        if (index % 2 === 1) {
          doc.rect(startX, y, rowWidth, rowHeight).fill('#f8f8f8');
        }

        doc.font('Helvetica').fontSize(8).fillColor('#000000');
        let x = startX;
        columns.forEach(col => {
          const text = row[col.key] !== undefined ? String(row[col.key]) : '';
          doc.text(text, x + cellPadding, y + 5, {
            width: col.width - 2 * cellPadding,
            align: col.align
          });
          x += col.width;
        });

        doc.rect(startX, y, rowWidth, rowHeight).stroke('#cccccc');
        y += rowHeight;
      });
    }

    const headerY = drawHeader(doc.page.margins.top);
    drawRows(headerY);

    doc.end();
    return await new Promise(resolve => {
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
    });
  }

  throw new Error('Unsupported export format');
};

// Repo report export (Excel/CSV/PDF)
exports.exportRepo = async (format, data) => {
  const processedData = preprocessRepoExportData(data);

  if (format === 'csv') {
    const parser = new Parser({
      fields: REPO_EXPORT_COLUMNS.map(col => ({ label: col.label, value: col.key }))
    });
    return parser.parse(processedData);
  }

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Repo Report');
    sheet.columns = REPO_EXPORT_COLUMNS.map(col => ({
      header: col.label,
      key: col.key
    }));

    const numeric2dpKeys = new Set(['principal_amount', 'rate', 'interest_amount', 'maturity_amount', 'face_value_as_per_counterparty']);
    const intKeys = new Set(['tenor']);

    const excelRows = processedData.map(row => {
      const next = { ...row };
      for (const k of numeric2dpKeys) next[k] = toExcelNumber(next[k]);
      for (const k of intKeys) {
        const n = toExcelNumber(next[k]);
        next[k] = n === null ? null : Math.trunc(n);
      }
      return next;
    });

    sheet.addRows(excelRows);

    for (const k of numeric2dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.00';
    }
    for (const k of intKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '0';
    }

    return workbook.xlsx.writeBuffer();
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {});

    doc.fontSize(20).font('Helvetica-Bold').text('Repo Report', { align: 'center' });
    doc.moveDown(1);

    const columns = REPO_EXPORT_COLUMNS.map(col => ({
      key: col.key,
      label: col.label,
      width: ['principal_amount', 'rate', 'tenor', 'interest_amount', 'maturity_amount', 'face_value_as_per_counterparty'].includes(col.key)
        ? 70
        : 80,
      align: ['principal_amount', 'rate', 'tenor', 'interest_amount', 'maturity_amount', 'face_value_as_per_counterparty'].includes(col.key)
        ? 'right'
        : 'left'
    }));

    const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const totalWidth = columns.reduce((sum, col) => sum + col.width, 0);
    if (totalWidth > maxWidth) {
      const scale = maxWidth / totalWidth;
      columns.forEach(col => {
        col.width = Math.floor(col.width * scale);
      });
    }

    const rowHeight = 20;
    const cellPadding = 4;
    const startX = doc.page.margins.left;

    function drawHeader(y) {
      const headerWidth = columns.reduce((sum, col) => sum + col.width, 0);
      doc.rect(startX, y, headerWidth, rowHeight).fillAndStroke('#f0f0f0', '#000000');
      doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold');

      let x = startX;
      columns.forEach(col => {
        doc.text(col.label, x + cellPadding, y + 5, {
          width: col.width - 2 * cellPadding,
          align: col.align
        });
        x += col.width;
      });
      return y + rowHeight;
    }

    function drawRows(startY) {
      let y = startY;
      processedData.forEach((row, index) => {
        if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          y = drawHeader(doc.page.margins.top);
        }

        const rowWidth = columns.reduce((sum, col) => sum + col.width, 0);
        if (index % 2 === 1) {
          doc.rect(startX, y, rowWidth, rowHeight).fill('#f8f8f8');
        }

        doc.font('Helvetica').fontSize(8).fillColor('#000000');
        let x = startX;
        columns.forEach(col => {
          const text = row[col.key] !== undefined ? String(row[col.key]) : '';
          doc.text(text, x + cellPadding, y + 5, {
            width: col.width - 2 * cellPadding,
            align: col.align
          });
          x += col.width;
        });

        doc.rect(startX, y, rowWidth, rowHeight).stroke('#cccccc');
        y += rowHeight;
      });
    }

    const headerY = drawHeader(doc.page.margins.top);
    drawRows(headerY);

    doc.end();
    return await new Promise(resolve => {
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
    });
  }

  throw new Error('Unsupported export format');
};

exports.exportTbillTransactions = async (format, data) => exportTabularReport(format, {
  title: 'T-Bill Transactions Report',
  sheetName: 'T-Bill Transactions',
  columns: TBILL_TRANSACTIONS_EXPORT_COLUMNS,
  rows: data,
  dateKeys: ['trade_date', 'value_date', 'maturity_date'],
  moneyKeys: ['face_value', 'settlement_amount', 'price_per_100', 'discount_rate_pct'],
  rateKeys: []
});

function preprocessTbillExportData(data) {
  return (data || []).map((row) => {
    const mapped = {};
    TBILL_EXPORT_COLUMNS.forEach((col) => {
      let val = row[col.key];
      if (col.key === 'trade_date' || col.key === 'value_date' || col.key === 'maturity_date') {
        val = formatDate(val);
      }
      mapped[col.key] = val !== undefined && val !== null ? val : '';
    });
    return mapped;
  });
}

// T-Bill report export (Excel/CSV/PDF)
exports.exportTbill = async (format, data) => {
  const processedData = preprocessTbillExportData(data);

  if (format === 'csv') {
    const parser = new Parser({
      fields: TBILL_EXPORT_COLUMNS.map((col) => ({ label: col.label, value: col.key }))
    });
    return parser.parse(processedData);
  }

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('T-Bill Report');
    sheet.columns = TBILL_EXPORT_COLUMNS.map((col) => ({
      header: col.label,
      key: col.key
    }));

    const numeric2dpKeys = new Set([
      'face_value', 'settlement_amount', 'remaining_face_value',
      'price_per_100', 'per_day_accrual', 'accrued_interest_to_date', 'discount_rate_pct'
    ]);
    const numeric4dpKeys = new Set([]);
    const intKeys = new Set(['days_to_maturity']);

    const excelRows = processedData.map((row) => {
      const next = { ...row };
      for (const k of numeric2dpKeys) next[k] = toExcelNumber(next[k]);
      for (const k of numeric4dpKeys) next[k] = toExcelNumber4(next[k]);
      for (const k of intKeys) {
        const n = toExcelNumber(next[k]);
        next[k] = n === null ? null : Math.trunc(n);
      }
      return next;
    });

    sheet.addRows(excelRows);

    for (const k of numeric2dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.00';
    }
    for (const k of numeric4dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.0000';
    }
    for (const k of intKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '0';
    }

    return workbook.xlsx.writeBuffer();
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {});

    doc.fontSize(20).font('Helvetica-Bold').text('T-Bill Report', { align: 'center' });
    doc.moveDown(1);

    const pdfColumns = [
      { key: 'deal_number', label: 'Deal Number', width: 95 },
      { key: 'isin_number', label: 'ISIN', width: 85 },
      { key: 'value_date', label: 'Value Date', width: 70 },
      { key: 'maturity_date', label: 'Maturity', width: 70 },
      { key: 'face_value', label: 'Face Value', width: 75, align: 'right' },
      { key: 'discount_rate_pct', label: 'Disc %', width: 55, align: 'right' },
      { key: 'settlement_amount', label: 'Settlement', width: 75, align: 'right' }
    ];

    const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const totalWidth = pdfColumns.reduce((sum, col) => sum + col.width, 0);
    if (totalWidth > maxWidth) {
      const scale = maxWidth / totalWidth;
      pdfColumns.forEach((col) => {
        col.width = Math.floor(col.width * scale);
      });
    }

    const rowHeight = 20;
    const cellPadding = 4;
    const startX = doc.page.margins.left;

    function drawHeader(y) {
      const headerWidth = pdfColumns.reduce((sum, col) => sum + col.width, 0);
      doc.rect(startX, y, headerWidth, rowHeight).fillAndStroke('#f0f0f0', '#000000');
      doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold');
      let x = startX;
      pdfColumns.forEach((col) => {
        doc.text(col.label, x + cellPadding, y + 5, {
          width: col.width - 2 * cellPadding,
          align: col.align || 'left'
        });
        x += col.width;
      });
      return y + rowHeight;
    }

    function drawRows(startY) {
      let y = startY;
      processedData.forEach((row, index) => {
        if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          y = drawHeader(doc.page.margins.top);
        }
        const rowWidth = pdfColumns.reduce((sum, col) => sum + col.width, 0);
        if (index % 2 === 1) {
          doc.rect(startX, y, rowWidth, rowHeight).fill('#f8f8f8');
        }
        doc.fillColor('#000000').fontSize(7).font('Helvetica');
        let x = startX;
        pdfColumns.forEach((col) => {
          doc.text(String(row[col.key] ?? ''), x + cellPadding, y + 5, {
            width: col.width - 2 * cellPadding,
            align: col.align || 'left'
          });
          x += col.width;
        });
        y += rowHeight;
      });
    }

    const headerY = drawHeader(doc.page.margins.top);
    drawRows(headerY);

    doc.end();
    return await new Promise((resolve) => {
      doc.on('end', () => {
        resolve(Buffer.concat(buffers));
      });
    });
  }

  throw new Error('Unsupported export format');
};

// Mark to Market report export columns
const MARK_TO_MARKET_EXPORT_COLUMNS = [
  { key: 'series', label: 'Series' },
  { key: 'isin', label: 'ISIN' },
  { key: 'instrument_type', label: 'Instrument' },
  { key: 'quote_source', label: 'Quote Source' },
  { key: 'isin_issuer', label: 'ISIN Issuer' },
  { key: 'maturity_date', label: 'Maturity Date' },
  { key: 'buying_price', label: 'Buying Price' },
  { key: 'selling_price', label: 'Selling Price' },
  { key: 'average_price', label: 'Average Price' },
  { key: 'dirty_price', label: 'Dirty Price' },
  { key: 'buying_yield', label: 'Buying Yield (%)' },
  { key: 'selling_yield', label: 'Selling Yield (%)' },
  { key: 'average_yield', label: 'Average Yield (%)' },
  { key: 'balance', label: 'Balance' },
  { key: 'wap', label: 'WAP' },
  { key: 'unrealized_gain', label: 'Unrealized Gain' },
  { key: 'last_updated', label: 'Last Updated' },
  { key: 'excel_source', label: 'Source' }
];

function preprocessMarkToMarketData(data) {
  return (data || []).map(row => {
    const mapped = {};
    MARK_TO_MARKET_EXPORT_COLUMNS.forEach(col => {
      let val = row[col.key];
      if (col.key === 'maturity_date' || col.key === 'last_updated') {
        val = formatDate(val);
      }
      mapped[col.key] = val !== undefined && val !== null ? val : '';
    });
    return mapped;
  });
}

exports.exportMarkToMarket = async (format, data) => {
  const processedData = preprocessMarkToMarketData(data);

  if (format === 'csv') {
    const parser = new Parser({
      fields: MARK_TO_MARKET_EXPORT_COLUMNS.map(col => ({ label: col.label, value: col.key }))
    });
    return parser.parse(processedData);
  }

  if (format === 'excel') {
    const numeric4dpKeys = new Set(['buying_price', 'selling_price', 'average_price', 'dirty_price', 'wap', 'unrealized_gain']);
    const numeric2dpKeys = new Set(['buying_yield', 'selling_yield', 'average_yield', 'balance']);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Mark to Market Report');
    sheet.columns = MARK_TO_MARKET_EXPORT_COLUMNS.map(col => ({ header: col.label, key: col.key }));

    const excelRows = processedData.map(row => {
      const next = { ...row };
      for (const k of numeric4dpKeys) next[k] = toExcelNumber4(next[k]);
      for (const k of numeric2dpKeys) next[k] = toExcelNumber(next[k]);
      return next;
    });

    sheet.addRows(excelRows);

    for (const k of numeric4dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.0000';
    }
    for (const k of numeric2dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.00';
    }

    return workbook.xlsx.writeBuffer();
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));

    doc.fontSize(20).font('Helvetica-Bold').text('Mark to Market Report', { align: 'center' });
    doc.moveDown(1);

    const columns = MARK_TO_MARKET_EXPORT_COLUMNS.map(col => ({
      key: col.key,
      label: col.label,
      width: 70,
      align: ['buying_price', 'selling_price', 'average_price', 'dirty_price', 'buying_yield', 'selling_yield', 'average_yield', 'balance', 'wap', 'unrealized_gain'].includes(col.key) ? 'right' : 'left'
    }));

    const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const totalWidth = columns.reduce((sum, col) => sum + col.width, 0);
    if (totalWidth > maxWidth) {
      const scale = maxWidth / totalWidth;
      columns.forEach(col => { col.width = Math.floor(col.width * scale); });
    }

    const rowHeight = 20;
    const cellPadding = 4;
    const startX = doc.page.margins.left;

    function drawHeader(y) {
      const headerWidth = columns.reduce((sum, col) => sum + col.width, 0);
      doc.rect(startX, y, headerWidth, rowHeight).fillAndStroke('#f0f0f0', '#000000');
      doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold');
      let x = startX;
      columns.forEach(col => {
        doc.text(col.label, x + cellPadding, y + 5, { width: col.width - 2 * cellPadding, align: col.align });
        x += col.width;
      });
      return y + rowHeight;
    }

    function drawRows(startY) {
      let y = startY;
      processedData.forEach((row, index) => {
        if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          y = drawHeader(doc.page.margins.top);
        }
        const rowWidth = columns.reduce((sum, col) => sum + col.width, 0);
        if (index % 2 === 1) doc.rect(startX, y, rowWidth, rowHeight).fill('#f8f8f8');
        doc.font('Helvetica').fontSize(8).fillColor('#000000');
        let x = startX;
        columns.forEach(col => {
          const text = row[col.key] !== undefined ? String(row[col.key]) : '';
          doc.text(text, x + cellPadding, y + 5, { width: col.width - 2 * cellPadding, align: col.align });
          x += col.width;
        });
        doc.rect(startX, y, rowWidth, rowHeight).stroke('#cccccc');
        y += rowHeight;
      });
    }

    const headerY = drawHeader(doc.page.margins.top);
    drawRows(headerY);

    doc.end();
    return await new Promise(resolve => {
      doc.on('end', () => resolve(Buffer.concat(buffers)));
    });
  }

  throw new Error('Unsupported export format');
};

// Counterparty Master Report Export Columns
const COUNTERPARTY_MASTER_COLUMNS = [
  { key: 'counterparty_type', label: 'Counterparty Type' },
  { key: 'cux_number', label: 'CUX Number' },
  { key: 'title', label: 'Title' },
  { key: 'short_name', label: 'Short Name' },
  { key: 'long_name', label: 'Long Name' },
  { key: 'company_name', label: 'Company Name' },
  { key: 'id_type', label: 'ID Type' },
  { key: 'nic_number', label: 'NIC Number' },
  { key: 'registration_number', label: 'Registration Number' },
  { key: 'tin_number', label: 'TIN Number' },
  { key: 'vat_number', label: 'VAT Number' },
  { key: 'address', label: 'Address' },
  { key: 'telephone', label: 'Telephone' },
  { key: 'email', label: 'Email' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'custodian_bank', label: 'Custodian Bank' },
  { key: 'cds_account', label: 'CDS Account' }
];

exports.exportCounterpartyMaster = async (format, data) => {
  if (format === 'csv') {
    const parser = new Parser({ 
      fields: COUNTERPARTY_MASTER_COLUMNS.map(col => ({ label: col.label, value: col.key }))
    });
    return parser.parse(data);
  }
  
  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Counterparty Master');
    
    // Set column headers
    sheet.columns = COUNTERPARTY_MASTER_COLUMNS.map(col => ({ 
      header: col.label, 
      key: col.key,
      width: 20
    }));
    
    // Style header row
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
    sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Add data rows
    sheet.addRows(data);
    
    // Auto-fit columns
    sheet.columns.forEach(column => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const columnLength = cell.value ? cell.value.toString().length : 10;
        if (columnLength > maxLength) {
          maxLength = columnLength;
        }
      });
      column.width = maxLength < 10 ? 10 : maxLength > 50 ? 50 : maxLength + 2;
    });
    
    return workbook.xlsx.writeBuffer();
  }
  
  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {});
    
    // Title
    doc.fontSize(20).font('Helvetica-Bold').text('Counterparty Master Report', { align: 'center' });
    doc.moveDown(1);
    
    // Table columns
    const columns = [
      { key: 'counterparty_type', label: 'Type', width: 50 },
      { key: 'cux_number', label: 'CUX', width: 60 },
      { key: 'short_name', label: 'Short Name', width: 80 },
      { key: 'long_name', label: 'Long Name', width: 100 },
      { key: 'nic_number', label: 'NIC', width: 70 },
      { key: 'email', label: 'Email', width: 100 },
      { key: 'telephone', label: 'Phone', width: 70 },
      { key: 'address', label: 'Address', width: 120 }
    ];
    
    // Draw header
    let y = doc.y;
    const rowHeight = 25;
    const startX = doc.page.margins.left;
    let x = startX;
    
    doc.rect(startX, y, columns.reduce((sum, col) => sum + col.width, 0), rowHeight)
       .fillAndStroke('#f0f0f0', '#000000');
    doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold');
    
    columns.forEach(col => {
      doc.text(col.label, x + 4, y + 6, { width: col.width - 8 });
      x += col.width;
    });
    
    y += rowHeight;
    
    // Draw rows
    data.forEach((row, index) => {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top + 20;
        x = startX;
        doc.rect(startX, y, columns.reduce((sum, col) => sum + col.width, 0), rowHeight)
           .fillAndStroke('#f0f0f0', '#000000');
        doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold');
        columns.forEach(col => {
          doc.text(col.label, x + 4, y + 6, { width: col.width - 8 });
          x += col.width;
        });
        y += rowHeight;
        x = startX;
      }
      
      doc.fontSize(8).font('Helvetica');
      columns.forEach(col => {
        const value = String(row[col.key] || '');
        doc.text(value.substring(0, 30), x + 4, y + 6, { width: col.width - 8 });
        x += col.width;
      });
      y += rowHeight;
      x = startX;
    });
    
    doc.end();
    
    return await new Promise(resolve => {
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
    });
  }
  
  throw new Error('Unsupported export format');
};

/**
 * Daily Maturity Handling export — same fields/values as the on-screen table,
 * plus a trailing Balance row under Settlement Value.
 */
exports.exportDailyMaturityCashflow = async (format, rows, totals = {}) => {
  const processedData = (rows || []).map((row) => {
    const settlement =
      row.settlement_value != null
        ? Number(row.settlement_value)
        : row.cash_flow === 'Less'
          ? -Math.abs(Number(row.maturity_amount) || 0)
          : Math.abs(Number(row.maturity_amount) || 0);
    return {
      event_type: row.event_type === 'settlement' ? 'New Deal' : 'Maturity',
      cash_flow: row.cash_flow || '',
      instrument: row.instrument || '',
      description: row.description || '',
      deal_number: row.deal_number || '',
      reference_deal_number: row.reference_deal_number || '—',
      settlement_value: Number.isFinite(settlement) ? settlement : null,
      val_mat: row.val_mat || '',
      status: row.status || '',
      value_date: formatDate(row.value_date || row.maturity_date || ''),
      opening_balance:
        row.opening_balance == null || row.opening_balance === ''
          ? null
          : toExcelNumber(row.opening_balance)
    };
  });

  const balanceAmount = toExcelNumber(totals.net_cashflow ?? 0);
  const balanceRow = {
    event_type: '',
    cash_flow: '',
    instrument: '',
    description: '',
    deal_number: '',
    reference_deal_number: 'Balance',
    settlement_value: balanceAmount,
    val_mat: '',
    status: '',
    value_date: '',
    opening_balance: null
  };

  if (format === 'csv') {
    const parser = new Parser({
      fields: MATURITY_CASHFLOW_EXPORT_COLUMNS.map((col) => ({ label: col.label, value: col.key }))
    });
    return parser.parse([...processedData, balanceRow]);
  }

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Maturity Cashflow');
    sheet.columns = MATURITY_CASHFLOW_EXPORT_COLUMNS.map((col) => ({
      header: col.label,
      key: col.key,
      width: col.key === 'description' ? 42 : col.key === 'deal_number' || col.key === 'reference_deal_number' ? 22 : 16
    }));

    const excelRows = processedData.map((row) => ({
      ...row,
      settlement_value: toExcelNumber(row.settlement_value),
      opening_balance: toExcelNumber(row.opening_balance)
    }));
    sheet.addRows(excelRows);

    const bal = sheet.addRow({
      ...balanceRow,
      settlement_value: balanceAmount
    });
    bal.font = { bold: true };

    for (const k of ['settlement_value', 'opening_balance']) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.00';
    }

    return workbook.xlsx.writeBuffer();
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 28, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));

    doc.fontSize(16).font('Helvetica-Bold').text('Daily Maturity Cashflow', { align: 'center' });
    doc.moveDown(0.8);

    const columns = MATURITY_CASHFLOW_EXPORT_COLUMNS.map((col) => ({
      key: col.key,
      label: col.label,
      width:
        col.key === 'description' ? 150
          : col.key === 'deal_number' || col.key === 'reference_deal_number' ? 95
            : col.key === 'settlement_value' || col.key === 'opening_balance' ? 85
              : 70,
      align: ['settlement_value', 'opening_balance'].includes(col.key) ? 'right' : 'left'
    }));

    const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const totalWidth = columns.reduce((sum, col) => sum + col.width, 0);
    if (totalWidth > maxWidth) {
      const scale = maxWidth / totalWidth;
      columns.forEach((col) => {
        col.width = Math.floor(col.width * scale);
      });
    }

    const rowHeight = 18;
    const cellPadding = 3;
    const startX = doc.page.margins.left;
    let y = doc.y;

    const drawHeader = () => {
      const headerWidth = columns.reduce((sum, col) => sum + col.width, 0);
      doc.rect(startX, y, headerWidth, rowHeight).fillAndStroke('#f0f0f0', '#000000');
      doc.fillColor('#000000').fontSize(7).font('Helvetica-Bold');
      let x = startX;
      columns.forEach((col) => {
        doc.text(col.label, x + cellPadding, y + 5, {
          width: col.width - 2 * cellPadding,
          align: col.align
        });
        x += col.width;
      });
      y += rowHeight;
    };

    const drawRow = (row, bold = false) => {
      if (y > doc.page.height - doc.page.margins.bottom - rowHeight) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader();
      }
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7).fillColor('#000000');
      let x = startX;
      columns.forEach((col) => {
        let val = row[col.key];
        if (val == null || val === '') val = '';
        else if (['settlement_value', 'opening_balance'].includes(col.key) && typeof val === 'number') {
          val = val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } else val = String(val);
        doc.text(val, x + cellPadding, y + 4, {
          width: col.width - 2 * cellPadding,
          align: col.align
        });
        x += col.width;
      });
      y += rowHeight;
    };

    drawHeader();
    processedData.forEach((row) => drawRow(row));
    drawRow(balanceRow, true);

    doc.end();
    return new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(buffers)));
    });
  }

  throw new Error('Unsupported export format');
};

function preprocessGsecTransactionsExportData(data) {
  return (data || []).map((row) => {
    const mapped = {};
    GSEC_TRANSACTIONS_EXPORT_COLUMNS.forEach((col) => {
      let val = row[col.key];
      if (col.key === 'trade_date' || col.key === 'value_date' || col.key === 'maturity_date') {
        val = formatDate(val);
      }
      mapped[col.key] = val !== undefined && val !== null ? val : '';
    });
    return mapped;
  });
}

exports.exportGsecTransactions = async (format, data) => {
  const processedData = preprocessGsecTransactionsExportData(data);

  if (format === 'csv') {
    const parser = new Parser({
      fields: GSEC_TRANSACTIONS_EXPORT_COLUMNS.map((col) => ({ label: col.label, value: col.key }))
    });
    return parser.parse(processedData);
  }

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('GSec Transactions');
    sheet.columns = GSEC_TRANSACTIONS_EXPORT_COLUMNS.map((col) => ({
      header: col.label,
      key: col.key
    }));
    const numeric2dpKeys = new Set(['face_value', 'settlement_amount']);
    const numeric4dpKeys = new Set(['clean_price', 'dirty_price', 'yield', 'coupon_rate']);
    const excelRows = processedData.map((row) => {
      const next = { ...row };
      for (const k of numeric2dpKeys) next[k] = toExcelNumber(next[k]);
      for (const k of numeric4dpKeys) next[k] = toExcelNumber4(next[k]);
      return next;
    });
    sheet.addRows(excelRows);
    for (const k of numeric2dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.00';
    }
    for (const k of numeric4dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.0000';
    }
    return workbook.xlsx.writeBuffer();
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {});
    doc.fontSize(16).font('Helvetica-Bold').text('GSec Transactions Report', { align: 'center' });
    doc.moveDown(0.5);
    const columns = GSEC_TRANSACTIONS_EXPORT_COLUMNS.map((col) => ({
      key: col.key,
      label: col.label,
      width: 70,
      align: ['face_value', 'clean_price', 'dirty_price', 'yield', 'settlement_amount', 'coupon_rate'].includes(col.key)
        ? 'right'
        : 'left'
    }));
    const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const totalWidth = columns.reduce((sum, col) => sum + col.width, 0);
    if (totalWidth > maxWidth) {
      const scale = maxWidth / totalWidth;
      columns.forEach((col) => { col.width = Math.floor(col.width * scale); });
    }
    const rowHeight = 16;
    const drawHeader = (y) => {
      let x = doc.page.margins.left;
      doc.fontSize(7).font('Helvetica-Bold');
      columns.forEach((col) => {
        doc.text(col.label, x, y, { width: col.width, align: col.align });
        x += col.width;
      });
      return y + rowHeight;
    };
    let y = drawHeader(doc.y + 4);
    doc.font('Helvetica').fontSize(7);
    processedData.forEach((row) => {
      if (y > doc.page.height - doc.page.margins.bottom - rowHeight) {
        doc.addPage();
        y = drawHeader(doc.page.margins.top);
        doc.font('Helvetica').fontSize(7);
      }
      let x = doc.page.margins.left;
      columns.forEach((col) => {
        doc.text(String(row[col.key] ?? ''), x, y, { width: col.width, align: col.align });
        x += col.width;
      });
      y += rowHeight;
    });
    doc.end();
    return await new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(buffers)));
    });
  }

  throw new Error('Unsupported export format');
};

exports.getMimeType = (format) => {
  if (format === 'csv') return 'text/csv';
  if (format === 'excel') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (format === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
};

/**
 * Portfolio Mark to Market export - Finance's layout: title, report date, header,
 * one row per holding grouped by maturity (blank row between maturities), then the
 * GSEC Portfolio total. `payload` is services/portfolioMtmReportService's result.
 */
const PORTFOLIO_MTM_COLUMNS = [
  { key: 'maturity_date', label: 'Maturity', width: 14 },
  { key: 'face_value', label: 'Face Value Rs.', width: 20 },
  { key: 'coupon', label: 'Coupon', width: 11 },
  { key: 'purchased_yield', label: 'Purchased Yield', width: 15 },
  { key: 'market_yield', label: 'Market Yield', width: 13 },
  { key: 'value_at_purchased_yield', label: 'Value as at Purchased Yield', width: 26 },
  { key: 'value_at_market_yield', label: 'Value as at Market Yield', width: 24 },
  { key: 'profit_loss', label: 'Profit (Loss) Rs.', width: 20 }
];

function groupPortfolioMtmByMaturity(rows) {
  const groups = [];
  for (const row of rows || []) {
    const last = groups[groups.length - 1];
    if (last && last.maturity === row.maturity_date) last.rows.push(row);
    else groups.push({ maturity: row.maturity_date, rows: [row] });
  }
  return groups;
}

exports.exportPortfolioMarkToMarket = async (format, payload) => {
  const rows = (payload && payload.data) || [];
  const totals = (payload && payload.totals) || {};
  const asAt = (payload && payload.asAtDate) || '';
  const pct = (v) => (v === null || v === undefined || v === '' ? '' : Number(v) / 100);

  if (format === 'csv') {
    const parser = new Parser({ fields: PORTFOLIO_MTM_COLUMNS.map((c) => ({ label: c.label, value: c.key })) });
    const body = parser.parse(rows);
    return [
      'Portfolio Mark to market,,Date,' + asAt,
      '',
      body,
      '',
      'GSEC Portfolio,' + (totals.face_value == null ? '' : totals.face_value) + ',,,,,,' + (totals.profit_loss == null ? '' : totals.profit_loss)
    ].join('\n');
  }

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Mark to Market Report');
    sheet.columns = PORTFOLIO_MTM_COLUMNS.map((c) => ({ key: c.key, width: c.width }));

    sheet.addRow(['Portfolio Mark to market']).font = { bold: true, size: 14 };
    const dateRow = sheet.addRow(['Date', asAt]);
    dateRow.getCell(1).font = { bold: true };
    sheet.addRow([]);
    const header = sheet.addRow(PORTFOLIO_MTM_COLUMNS.map((c) => c.label));
    header.font = { bold: true };
    header.alignment = { wrapText: true, vertical: 'bottom' };

    let rowsAdded = 0;
    for (const group of groupPortfolioMtmByMaturity(rows)) {
      for (const r of group.rows) {
        const line = sheet.addRow([
          r.maturity_date,
          toExcelNumber(r.face_value),
          pct(r.coupon),
          pct(r.purchased_yield),
          pct(r.market_yield),
          r.value_at_purchased_yield === null || r.value_at_purchased_yield === undefined ? '' : Number(r.value_at_purchased_yield),
          r.value_at_market_yield === null || r.value_at_market_yield === undefined ? '' : Number(r.value_at_market_yield),
          toExcelNumber(r.profit_loss)
        ]);
        line.getCell(2).numFmt = '#,##0.00';
        for (const c of [3, 4, 5]) line.getCell(c).numFmt = '0.0000%';
        for (const c of [6, 7]) line.getCell(c).numFmt = '#,##0.000000';
        line.getCell(8).numFmt = '#,##0.00;[Red](#,##0.00)';
        rowsAdded++;
      }
      sheet.addRow([]);
    }

    const totalRow = sheet.addRow(['GSEC Portfolio', toExcelNumber(totals.face_value), '', '', '', '', '', toExcelNumber(totals.profit_loss)]);
    totalRow.font = { bold: true };
    totalRow.getCell(2).numFmt = '#,##0.00';
    totalRow.getCell(8).numFmt = '#,##0.00;[Red](#,##0.00)';
    sheet.addRow([]);
    sheet.addRow([rowsAdded + ' holding(s). Open Sell/Buy buyback positions are not included.']).font = { italic: true, size: 9 };

    return workbook.xlsx.writeBuffer();
  }

  if (format === 'pdf') {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(14).text('Portfolio Mark to market', { align: 'center' });
      doc.fontSize(9).text('Date: ' + asAt, { align: 'center' });
      doc.moveDown(0.6);

      const startX = 30;
      const widths = [70, 95, 55, 75, 70, 110, 105, 100];
      const headers = PORTFOLIO_MTM_COLUMNS.map((c) => c.label);
      const fmtNum = (v, dp) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
      const fmtPct = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(4) + '%');

      const drawRow = (cells, opts) => {
        const bold = opts && opts.bold;
        if (doc.y > doc.page.height - 50) doc.addPage();
        const y = doc.y;
        let x = startX;
        doc.fontSize(bold ? 8 : 7.5).font(bold ? 'Helvetica-Bold' : 'Helvetica');
        cells.forEach((text, i) => {
          doc.text(String(text === null || text === undefined ? '' : text), x, y, { width: widths[i], align: i === 0 ? 'left' : 'right' });
          x += widths[i];
        });
        doc.y = y + (bold ? 14 : 12);
      };

      drawRow(headers, { bold: true });
      for (const group of groupPortfolioMtmByMaturity(rows)) {
        for (const r of group.rows) {
          drawRow([
            r.maturity_date, fmtNum(r.face_value, 2), fmtPct(r.coupon), fmtPct(r.purchased_yield), fmtPct(r.market_yield),
            fmtNum(r.value_at_purchased_yield, 6), fmtNum(r.value_at_market_yield, 6), fmtNum(r.profit_loss, 2)
          ]);
        }
        doc.y += 4;
      }
      drawRow(['GSEC Portfolio', fmtNum(totals.face_value, 2), '', '', '', '', '', fmtNum(totals.profit_loss, 2)], { bold: true });
      doc.fontSize(7).font('Helvetica').text('Open Sell/Buy buyback positions are not included.', startX, doc.y + 6);
      doc.end();
    });
  }

  throw new Error('Unsupported format: ' + format);
};
