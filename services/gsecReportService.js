const db = require('../db'); // adjust if you use a different db import
const { differenceInDays, parseISO } = require('date-fns');

// Helper to truncate to 4 decimals
function truncate4(val) {
  return Math.floor(Number(val) * 10000) / 10000;
}

exports.getGsecReport = async ({ asAtDate, portfolio, isin, valueDate, maturityDate, page, pageSize }) => {
  // Build query with filters
  let sql = `SELECT portfolio, value_date, maturity_date, isin, coupon_interest, clean_price, yield, face_value, counterparty FROM gsec WHERE 1=1`;
  const params = [];
  if (portfolio) {
    sql += ' AND portfolio = ?';
    params.push(portfolio);
  }
  if (isin) {
    sql += ' AND isin = ?';
    params.push(isin);
  }
  if (valueDate) {
    sql += ' AND value_date = ?';
    params.push(valueDate);
  }
  if (maturityDate) {
    sql += ' AND maturity_date = ?';
    params.push(maturityDate);
  }
  sql += ' ORDER BY isin, maturity_date';

    if (deal_number) {
    sql += ' AND deal number = ?';
    params.push(deal_number);
  }
  sql += ' ORDER BY deal number, deal_number';
    
  
  // Pagination
  const offset = (page - 1) * pageSize;
  sql += ' LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

  // Query DB
  const [rows] = await db.query(sql, params);

  // Aggregate balance by ISIN
  const isinBalances = {};
  rows.forEach(row => {
    if (!isinBalances[row.isin]) isinBalances[row.isin] = 0;
    isinBalances[row.isin] += Number(row.face_value);
  });

  // Helper to safely parse ISO date strings
  function safeParseISO(val) {
    if (!val) return null;
    if (typeof val === 'string') return parseISO(val);
    if (val instanceof Date) return val;
    return null;
  }

  // Format results
  const data = rows.map(row => {
    const maturityDateObj = safeParseISO(row.maturity_date);
    const asAtDateObj = safeParseISO(asAtDate);
    let dtm = '';
    if (maturityDateObj && asAtDateObj) {
      dtm = differenceInDays(maturityDateObj, asAtDateObj);
    }
    return {
      portfolio: row.portfolio,
      value_date: row.value_date,
      maturity_date: row.maturity_date,
      isin: row.isin,
      coupon_interest: truncate4(row.coupon_interest).toFixed(4),
      clean_price: truncate4(row.clean_price).toFixed(4),
      yield: truncate4(row.yield).toFixed(4),
      dtm,
      balance: truncate4(isinBalances[row.isin]).toFixed(4),
      repo_collateral: '',
      counterparty: row.counterparty
    };
  });

  // Get total count for pagination
  const [[{ count }]] = await db.query(`SELECT COUNT(*) as count FROM gsec WHERE 1=1` +
    (portfolio ? ' AND portfolio = ?' : '') +
    (isin ? ' AND isin = ?' : '') +
    (valueDate ? ' AND value_date = ?' : '') +
    (maturityDate ? ' AND maturity_date = ?' : ''),
    params.slice(0, params.length - 2)
  );

  return { data, total: count };
};
