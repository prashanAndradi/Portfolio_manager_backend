const db = require('../db');
const { differenceInDays, parseISO } = require('date-fns');
const { calculateNVP } = require('../utils/bondPricingNVP');

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

exports.getSellTransactionReport = async ({ asAtDate, portfolio, isin, valueDate, maturityDate, page, pageSize }) => {
  // Build query with filters - only include Sell transactions from GSEC deals
  let sql = `SELECT g.id, g.portfolio, g.deal_number, g.face_value, g.value_date, g.maturity_date, g.isin_number as isin, g.coupon_interest, g.clean_price, g.yield, g.counterparty_id, g.transaction_type, 
             g.buy_deal_number, g.accrued_interest, g.dirty_price, g.settlement_amount,
             COALESCE(corp.short_name, ind.short_name, joint.short_name, CONCAT('ID:', g.counterparty_id)) as counterparty,
             im.coupon_rate, im.issue_date, im.coupon_date_1, im.coupon_date_2
    FROM gsec g 
    LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_0900_ai_ci = im.isin_number COLLATE utf8mb4_0900_ai_ci
    LEFT JOIN counterparty_master_corporate corp ON g.counterparty_id = corp.id
    LEFT JOIN counterparty_master_individual ind ON g.counterparty_id = ind.id
    LEFT JOIN counterparty_master_joint joint ON g.counterparty_id = joint.id
    WHERE g.transaction_type = 'Sell'`;
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
  }
  
  // Add ordering
  sql += ` ORDER BY g.value_date DESC, g.id DESC`;

  // Pagination - only apply if page and pageSize are provided
  if (page && pageSize) {
    // Ensure page and pageSize are numbers (defensive conversion)
    const pageNum = typeof page === 'number' ? page : parseInt(page, 10);
    const pageSizeNum = typeof pageSize === 'number' ? pageSize : parseInt(pageSize, 10);
    const offset = (pageNum - 1) * pageSizeNum;
    sql += ' LIMIT ? OFFSET ?';
    params.push(pageSizeNum, offset);
  }

  // Query DB
  const [rows] = await db.query(sql, params);

  // Get all unique ISINs from the current page results
  const uniqueIsins = [...new Set(rows.map(row => row.isin || row.isin_number))];

  // Calculate balance for each ISIN across ALL records (not just current page)
  const isinBalances = {};
  const isinWapMap = {};
  
  for (const isin of uniqueIsins) {
    // Query all Buy records for this ISIN to calculate correct balance
    let balanceSql = `SELECT face_value, clean_price FROM gsec WHERE isin_number = ? AND transaction_type = 'Buy'`;
    const balanceParams = [isin];
    
    // Apply the same filters as the main query for GSEC deals
    if (portfolio) {
      balanceSql += ' AND portfolio = ?';
      balanceParams.push(portfolio);
    }
    if (valueDate) {
      balanceSql += ' AND value_date = ?';
      balanceParams.push(valueDate);
    }
    if (maturityDate) {
      balanceSql += ' AND maturity_date = ?';
      balanceParams.push(maturityDate);
    }
    if (asAtDate) {
      balanceSql += ' AND value_date <= ?';
      balanceParams.push(asAtDate);
    }
    
    const [balanceRows] = await db.query(balanceSql, balanceParams);
    
    // Calculate balance for this ISIN (only Buy transactions)
    isinBalances[isin] = 0;
    isinWapMap[isin] = { sumFV: 0, sumFVCP: 0 };
    
    balanceRows.forEach(balanceRow => {
      // Only Buy transactions contribute to balance
      isinBalances[isin] += Number(balanceRow.face_value);

      // Aggregate for WAP calculation
      const fv = Number(balanceRow.face_value) || 0;
      const cp = Number(balanceRow.clean_price) || 0;
      isinWapMap[isin].sumFV += fv;
      isinWapMap[isin].sumFVCP += fv * cp;
    });
  }

  // Helper to safely parse ISO date strings
  function safeParseISO(val) {
    if (!val) return null;
    if (typeof val === 'string') return parseISO(val);
    if (val instanceof Date) return val;
    return null;
  }

  // Get current system date for NVP calculation
  const systemDate = new Date().toISOString().split('T')[0];

  // Format results
  const data = rows.map(row => {
    const maturityDateObj = safeParseISO(row.maturity_date);
    const asAtDateObj = safeParseISO(asAtDate);
    let dtm = '';
    if (maturityDateObj && asAtDateObj) {
      dtm = differenceInDays(maturityDateObj, asAtDateObj);
    }

    // Calculate NVP using system date as value date
    const nvpResult = calculateNVP({
      faceValue: row.face_value,
      couponRate: row.coupon_rate,
      yieldRate: row.yield,
      systemDate: systemDate,
      maturityDate: row.maturity_date,
      issueDate: row.issue_date,
      couponDate1: row.coupon_date_1,
      couponDate2: row.coupon_date_2
    });

    // Calculate available balance: balance - repo_collateral - sell_back
    const isinValue = row.isin || row.isin_number;
    const balance = Number(truncate4(isinBalances[isinValue] || 0).toFixed(4));
    const availableBalance = balance; // No repo collateral or sell back for sell transactions

    return {
      id: row.id,
      portfolio: row.portfolio,
      custodian: '', // custodian column doesn't exist in gsec table
      deal_number: row.deal_number || '',
      face_value: formatCurrency(row.face_value, 2),
      value_date: row.value_date,
      maturity_date: row.maturity_date,
      isin: isinValue,
      // One coupon period on this row's face, from the ISIN rate; the stored value is an
      // entry-time figure (some rows hold the annual amount), so it is only a fallback.
      coupon_interest: formatPrice(
        Number(row.coupon_rate) > 0 ? (Number(row.face_value) * Number(row.coupon_rate)) / 100 / 2 : row.coupon_interest,
        4
      ),
      clean_price: formatPrice(row.clean_price, 4),
      yield: formatPercentage(row.yield, 4),
      dtm: dtm ? dtm.toLocaleString('en-US') : '',
      balance: formatPrice(isinBalances[isinValue] || 0, 4),
      available_balance: formatPrice(availableBalance, 4),
      wap: (function() {
        const wapData = isinWapMap[isinValue];
        if (wapData && wapData.sumFV) {
          const wapValue = Math.floor((wapData.sumFVCP / wapData.sumFV) * 10000) / 10000;
          return formatPrice(wapValue, 4);
        }
        return '';
      })(),
      nvp: nvpResult.nvp ? formatPrice(nvpResult.nvp, 4) : '',
      accrued_interest: nvpResult.accruedInterest ? formatPrice(nvpResult.accruedInterest, 4) : '',
      counterparty: row.counterparty || '',
      transaction_type: row.transaction_type || '',
      buy_deal_number: row.buy_deal_number || '',
      dirty_price: formatPrice(row.dirty_price, 4),
      settlement_amount: formatCurrency(row.settlement_amount, 2)
    };
  });

  // Get total count for pagination - only count Sell transactions
  let countParams = [];
  if (portfolio) countParams.push(portfolio);
  if (isin) countParams.push(isin);
  if (valueDate) countParams.push(valueDate);
  if (maturityDate) countParams.push(maturityDate);
  if (asAtDate) countParams.push(asAtDate);
  
  // Count query - only Sell transactions from GSEC
  let countSql = `SELECT COUNT(*) as count FROM gsec g 
    WHERE g.transaction_type = 'Sell'` +
    (portfolio ? ' AND g.portfolio = ?' : '') +
    (isin ? ' AND g.isin_number = ?' : '') +
    (valueDate ? ' AND g.value_date = ?' : '') +
    (maturityDate ? ' AND g.maturity_date = ?' : '') +
    (asAtDate ? ' AND g.value_date <= ?' : '');
  
  const [[{ count }]] = await db.query(countSql, countParams);

  // Calculate total portfolio balance when portfolio filter is applied
  let totalPortfolioBalance = null;
  if (portfolio) {
    // Calculate total balance only for Buy transactions
    const balanceSql = `SELECT face_value FROM gsec g WHERE g.transaction_type = 'Buy'` +
      (portfolio ? ' AND g.portfolio = ?' : '') +
      (isin ? ' AND g.isin_number = ?' : '') +
      (valueDate ? ' AND g.value_date = ?' : '') +
      (maturityDate ? ' AND g.maturity_date = ?' : '') +
      (asAtDate ? ' AND g.value_date <= ?' : '');
    
    const balanceParams = [];
    if (portfolio) balanceParams.push(portfolio);
    if (isin) balanceParams.push(isin);
    if (valueDate) balanceParams.push(valueDate);
    if (maturityDate) balanceParams.push(maturityDate);
    if (asAtDate) balanceParams.push(asAtDate);
    
    const [balanceRows] = await db.query(balanceSql, balanceParams);
    
    let totalBalance = 0;
    balanceRows.forEach(balanceRow => {
      totalBalance += Number(balanceRow.face_value);
    });
    
    totalPortfolioBalance = formatPrice(totalBalance, 4);
  }

  return { data, total: count, totalPortfolioBalance };
};
