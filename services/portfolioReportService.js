const db = require('../db');

// Helper function to format date
function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  } catch (e) {
    return dateStr;
  }
}

// Helper to format currency
function formatCurrency(value, decimals = 2) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (isNaN(num)) return '';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

// Helper to format price
function formatPrice(value, decimals = 4) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (isNaN(num)) return '';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

exports.getPortfolioReport = async ({ asAtDate, startDate, endDate, product, portfolio, page, pageSize }) => {
  // As-at reporting: everything dealt on or before the date. startDate/endDate are still
  // accepted so older callers keep working, but asAtDate wins when both are given.
  const effectiveAsAt = asAtDate || endDate || null;
  console.log(`[Portfolio Report] Called with asAtDate: ${effectiveAsAt}, product: ${product}, portfolio: ${portfolio}`);
  
  const results = [];
  
  // Helper function to build date filter for a specific column
  const buildDateFilter = (columnName) => {
    const filterParams = [];
    let filter = '';
    if (asAtDate) {
      // Holdings as at the date: dealt on or before it.
      filter = ` AND DATE(${columnName}) <= DATE(?)`;
      filterParams.push(asAtDate);
    } else if (startDate && endDate) {
      filter = ` AND ${columnName} >= ? AND ${columnName} <= ?`;
      filterParams.push(startDate, endDate);
    } else if (startDate) {
      filter = ` AND ${columnName} >= ?`;
      filterParams.push(startDate);
    } else if (endDate) {
      filter = ` AND ${columnName} <= ?`;
      filterParams.push(endDate);
    }
    return { filter, params: filterParams };
  };
  
  // Helper function to build portfolio filter for a specific column
  const buildPortfolioFilter = (columnName) => {
    if (!portfolio) {
      return { filter: '', params: [] };
    }
    return { filter: ` AND ${columnName} = ?`, params: [portfolio] };
  };
  
  // Query GSec deals
  if (!product || product === 'gsec') {
    const gsecDateFilter = buildDateFilter('g.value_date');
    const gsecPortfolioFilter = buildPortfolioFilter('g.portfolio');
    
    let gsecSql = `
      SELECT 
        'GSec' as product_type,
        g.deal_number,
        g.value_date,
        g.trade_date,
        g.isin_number as isin,
        g.face_value,
        g.clean_price,
        g.dirty_price,
        g.settlement_amount,
        g.maturity_date,
        NULL as maturity_amount,
        g.portfolio,
        NULL as custodian,
        g.counterparty_id as counterparty,
        COALESCE(
          corp.short_name,
          ind.short_name,
          joint.short_name,
          g.counterparty_id
        ) as counterparty_name,
        g.transaction_type,
        g.status,
        g.currency
      FROM gsec g
      LEFT JOIN counterparty_master_corporate corp ON CONCAT('c', corp.id) = g.counterparty_id
      LEFT JOIN counterparty_master_individual ind ON CONCAT('i', ind.id) = g.counterparty_id
      LEFT JOIN counterparty_master_joint joint ON CONCAT('j', joint.id) = g.counterparty_id
      WHERE 1=1
    `;
    
    gsecSql += gsecDateFilter.filter;
    gsecSql += gsecPortfolioFilter.filter;
    gsecSql += ` ORDER BY g.value_date DESC, g.deal_number`;
    
    const gsecParams = [...gsecDateFilter.params, ...gsecPortfolioFilter.params];
    const [gsecRows] = await db.query(gsecSql, gsecParams);
    
    gsecRows.forEach(row => {
      // Determine if deal has matured (maturity_date <= endDate or today)
      const maturityDate = row.maturity_date ? new Date(row.maturity_date) : null;
      const endDateObj = effectiveAsAt ? new Date(effectiveAsAt) : new Date();
      const isMatured = maturityDate && maturityDate <= endDateObj;
      
      // Use maturity_amount if matured, otherwise settlement_amount
      const amount = isMatured && row.maturity_amount ? row.maturity_amount : (row.settlement_amount || row.face_value);
      
      results.push({
        product_type: 'GSec',
        deal_number: row.deal_number,
        value_date: row.value_date,
        trade_date: row.trade_date,
        isin: row.isin,
        face_value: row.face_value,
        clean_price: row.clean_price,
        dirty_price: row.dirty_price,
        settlement_amount: !isMatured ? (row.settlement_amount || row.face_value) : null,
        maturity_amount: isMatured && row.maturity_amount ? row.maturity_amount : null,
        amount: amount, // Combined field for display
        maturity_date: row.maturity_date,
        portfolio: row.portfolio,
        custodian: row.custodian,
        counterparty: row.counterparty_name || row.counterparty,
        transaction_type: row.transaction_type,
        status: row.status,
        currency: row.currency || 'LKR'
      });
    });
  }
  
  // Query Money Market deals
  if (!product || product === 'money_market') {
    const mmDateFilter = buildDateFilter('mmd.value_date');
    // Money Market doesn't have portfolio column, so skip portfolio filter
    
    let mmSql = `
      SELECT 
        'Money Market' as product_type,
        mmd.deal_number,
        mmd.value_date,
        mmd.trade_date,
        NULL as isin,
        mmd.principal_amount as face_value,
        NULL as clean_price,
        NULL as dirty_price,
        mmd.principal_amount as settlement_amount,
        mmd.maturity_date,
        mmd.maturity_value as maturity_amount,
        NULL as portfolio,
        NULL as custodian,
        mmd.counterparty_id as counterparty,
        COALESCE(
          corp.short_name,
          ind.short_name,
          joint.short_name,
          mmd.counterparty_id
        ) as counterparty_name,
        'Buy' as transaction_type,
        NULL as status,
        mmd.currency
      FROM money_market_deals mmd
      LEFT JOIN counterparty_master_corporate corp ON mmd.counterparty_id = corp.id
      LEFT JOIN counterparty_master_individual ind ON mmd.counterparty_id = ind.id
      LEFT JOIN counterparty_master_joint joint ON mmd.counterparty_id = joint.id
      WHERE 1=1
    `;
    
    mmSql += mmDateFilter.filter;
    mmSql += ` ORDER BY mmd.value_date DESC, mmd.deal_number`;
    
    const mmParams = [...mmDateFilter.params];
    const [mmRows] = await db.query(mmSql, mmParams);
    
    mmRows.forEach(row => {
      // Determine if deal has matured
      const maturityDate = row.maturity_date ? new Date(row.maturity_date) : null;
      const endDateObj = effectiveAsAt ? new Date(effectiveAsAt) : new Date();
      const isMatured = maturityDate && maturityDate <= endDateObj;
      
      // Use maturity_value if matured, otherwise principal_amount
      const amount = isMatured && row.maturity_amount ? row.maturity_amount : (row.settlement_amount || row.face_value);
      
      results.push({
        product_type: 'Money Market',
        deal_number: row.deal_number,
        value_date: row.value_date,
        trade_date: row.trade_date,
        isin: row.isin,
        face_value: row.face_value,
        clean_price: row.clean_price,
        dirty_price: row.dirty_price,
        settlement_amount: !isMatured ? (row.settlement_amount || row.face_value) : null,
        maturity_amount: isMatured && row.maturity_amount ? row.maturity_amount : null,
        amount: amount, // Combined field for display
        maturity_date: row.maturity_date,
        portfolio: row.portfolio,
        custodian: row.custodian,
        counterparty: row.counterparty_name || row.counterparty,
        transaction_type: row.transaction_type,
        status: row.status,
        currency: row.currency || 'LKR'
      });
    });
  }
  
  // Query Repo deals
  if (!product || product === 'repo') {
    const repoDateFilter = buildDateFilter('rd.value_date');
    // Repo doesn't have portfolio, so skip portfolio filter
    
    let repoSql = `
      SELECT 
        'Repo' as product_type,
        rd.deal_number AS deal_number,
        rd.value_date,
        rd.trade_date,
        rd.isin_number as isin,
        rd.face_value,
        NULL as clean_price,
        NULL as dirty_price,
        rd.principal_amount as settlement_amount,
        rd.maturity_date,
        rd.maturity_amount,
        NULL as portfolio,
        NULL as custodian,
        rd.counterparty_id as counterparty,
        COALESCE(
          corp.short_name,
          ind.short_name,
          joint.short_name,
          rd.counterparty_id
        ) as counterparty_name,
        rd.deal_type as transaction_type,
        rd.status,
        'LKR' as currency
      FROM repo_deals rd
      LEFT JOIN counterparty_master_corporate corp ON rd.counterparty_id = corp.id
      LEFT JOIN counterparty_master_individual ind ON rd.counterparty_id = ind.id
      LEFT JOIN counterparty_master_joint joint ON rd.counterparty_id = joint.id
      WHERE 1=1
    `;
    
    repoSql += repoDateFilter.filter;
    repoSql += ` ORDER BY rd.value_date DESC, rd.id`;
    
    const repoParams = [...repoDateFilter.params];
    const [repoRows] = await db.query(repoSql, repoParams);
    
    repoRows.forEach(row => {
      // Determine if deal has matured
      const maturityDate = row.maturity_date ? new Date(row.maturity_date) : null;
      const endDateObj = effectiveAsAt ? new Date(effectiveAsAt) : new Date();
      const isMatured = maturityDate && maturityDate <= endDateObj;
      
      // Use maturity_amount if matured, otherwise principal_amount
      const amount = isMatured && row.maturity_amount ? row.maturity_amount : (row.settlement_amount || row.face_value);
      
      results.push({
        product_type: 'Repo',
        deal_number: row.deal_number,
        value_date: row.value_date,
        trade_date: row.trade_date,
        isin: row.isin,
        face_value: row.face_value,
        clean_price: row.clean_price,
        dirty_price: row.dirty_price,
        settlement_amount: !isMatured ? (row.settlement_amount || row.face_value) : null,
        maturity_amount: isMatured && row.maturity_amount ? row.maturity_amount : null,
        amount: amount, // Combined field for display
        maturity_date: row.maturity_date,
        portfolio: row.portfolio,
        custodian: row.custodian,
        counterparty: row.counterparty_name || row.counterparty,
        transaction_type: row.transaction_type,
        status: row.status,
        currency: row.currency || 'LKR'
      });
    });
  }
  
  // Query Buyback deals
  if (!product || product === 'buyback') {
    const buybackDateFilter = buildDateFilter('bd.leg1_value_date');
    const buybackPortfolioFilter = buildPortfolioFilter('bd.leg1_portfolio');
    
    let buybackSql = `
      SELECT 
        'Buyback' as product_type,
        bd.deal_number,
        bd.leg1_value_date as value_date,
        bd.leg1_trade_date as trade_date,
        bd.leg1_isin as isin,
        bd.leg1_face_value as face_value,
        bd.leg1_clean_price as clean_price,
        bd.leg1_dirty_price as dirty_price,
        bd.leg1_settlement_amount as settlement_amount,
        bd.maturity_date,
        NULL as maturity_amount,
        bd.leg1_portfolio as portfolio,
        bd.leg1_custodian as custodian,
        bd.leg1_counterparty as counterparty,
        COALESCE(
          corp.short_name,
          ind.short_name,
          joint.short_name,
          bd.leg1_counterparty
        ) as counterparty_name,
        bd.leg1_transaction_type as transaction_type,
        bd.deal_status as status,
        bd.leg1_currency as currency
      FROM buyback_deals bd
      LEFT JOIN counterparty_master_corporate corp ON CONCAT('c', corp.id) = bd.leg1_counterparty
      LEFT JOIN counterparty_master_individual ind ON CONCAT('i', ind.id) = bd.leg1_counterparty
      LEFT JOIN counterparty_master_joint joint ON CONCAT('j', joint.id) = bd.leg1_counterparty
      WHERE 1=1
    `;
    
    buybackSql += buybackDateFilter.filter;
    buybackSql += buybackPortfolioFilter.filter;
    buybackSql += ` ORDER BY bd.leg1_value_date DESC, bd.deal_number`;
    
    const buybackParams = [...buybackDateFilter.params, ...buybackPortfolioFilter.params];
    const [buybackRows] = await db.query(buybackSql, buybackParams);
    
    buybackRows.forEach(row => {
      // Buyback deals use settlement_amount (no maturity_amount typically)
      results.push({
        product_type: 'Buyback',
        deal_number: row.deal_number,
        value_date: row.value_date,
        trade_date: row.trade_date,
        isin: row.isin,
        face_value: row.face_value,
        clean_price: row.clean_price,
        dirty_price: row.dirty_price,
        settlement_amount: row.settlement_amount || row.face_value,
        maturity_amount: row.maturity_amount,
        amount: row.settlement_amount || row.face_value, // Combined field for display
        maturity_date: row.maturity_date,
        portfolio: row.portfolio,
        custodian: row.custodian,
        counterparty: row.counterparty_name || row.counterparty,
        transaction_type: row.transaction_type,
        status: row.status,
        currency: row.currency || 'LKR'
      });
    });
  }
  
  // Query T-Bill deals
  if (!product || product === 'tbill') {
    const tbillDateFilter = buildDateFilter('t.value_date');

    let tbillPortfolioWhere = '';
    const tbillPortfolioParams = [];
    if (portfolio) {
      tbillPortfolioWhere = ` AND CAST(t.portfolio_id AS CHAR) = ?`;
      tbillPortfolioParams.push(String(portfolio));
    }

    const tbillSql = `
      SELECT
        'T-Bill' AS product_type,
        t.deal_number,
        t.value_date,
        t.trade_date,
        t.isin_number AS isin,
        t.face_value,
        NULL AS clean_price,
        t.price_per_100 AS dirty_price,
        t.settlement_amount,
        t.maturity_date,
        NULL AS maturity_amount,
        t.portfolio_id AS portfolio_raw,
        pm.portfolio_name AS portfolio,
        t.counterparty,
        COALESCE(corp.short_name, ind.short_name, joint.short_name, t.counterparty) AS counterparty_name,
        t.transaction_type,
        t.status,
        'LKR' AS currency
      FROM tbill t
      LEFT JOIN portfolio_master pm
        ON CAST(t.portfolio_id AS CHAR) = CAST(pm.portfolio_id AS CHAR)
      LEFT JOIN counterparty_master_corporate corp
        ON (t.counterparty LIKE 'c%' AND CAST(SUBSTRING(t.counterparty, 2) AS UNSIGNED) = corp.id)
        OR (t.counterparty = corp.id)
      LEFT JOIN counterparty_master_individual ind
        ON (t.counterparty LIKE 'i%' AND CAST(SUBSTRING(t.counterparty, 2) AS UNSIGNED) = ind.id)
        OR (t.counterparty = ind.id)
      LEFT JOIN counterparty_master_joint joint
        ON (t.counterparty LIKE 'j%' AND CAST(SUBSTRING(t.counterparty, 2) AS UNSIGNED) = joint.id)
        OR (t.counterparty = joint.id)
      WHERE 1=1
    `;

    const tbillParams = [...tbillDateFilter.params, ...tbillPortfolioParams];
    const [tbillRows] = await db.query(
      tbillSql + tbillDateFilter.filter + tbillPortfolioWhere + ' ORDER BY t.value_date DESC, t.deal_number',
      tbillParams
    );

    tbillRows.forEach(row => {
      const maturityDate = row.maturity_date ? new Date(row.maturity_date) : null;
      const endDateObj = effectiveAsAt ? new Date(effectiveAsAt) : new Date();
      const isMatured = maturityDate && maturityDate <= endDateObj;
      const amount = isMatured && row.maturity_amount ? row.maturity_amount : (row.settlement_amount || row.face_value);

      results.push({
        product_type: 'T-Bill',
        deal_number: row.deal_number,
        value_date: row.value_date,
        trade_date: row.trade_date,
        isin: row.isin,
        face_value: row.face_value,
        clean_price: null,
        dirty_price: row.dirty_price,
        settlement_amount: !isMatured ? (row.settlement_amount || row.face_value) : null,
        maturity_amount: isMatured && row.maturity_amount ? row.maturity_amount : null,
        amount,
        maturity_date: row.maturity_date,
        portfolio: row.portfolio || row.portfolio_raw,
        custodian: null,
        counterparty: row.counterparty_name || row.counterparty,
        transaction_type: row.transaction_type,
        status: row.status,
        currency: 'LKR'
      });
    });
  }

  // Sort all results by value_date descending
  results.sort((a, b) => {
    const dateA = new Date(a.value_date || 0);
    const dateB = new Date(b.value_date || 0);
    return dateB - dateA;
  });
  
  // Apply pagination
  const total = results.length;
  let paginatedResults = results;
  if (page && pageSize) {
    const offset = (page - 1) * pageSize;
    paginatedResults = results.slice(offset, offset + pageSize);
  }
  
  // Format the results
  const formattedResults = paginatedResults.map(row => ({
    ...row,
    value_date: row.value_date ? formatDate(row.value_date) : '',
    trade_date: row.trade_date ? formatDate(row.trade_date) : '',
    maturity_date: row.maturity_date ? formatDate(row.maturity_date) : '',
    face_value: formatCurrency(row.face_value, 2),
    clean_price: row.clean_price ? formatPrice(row.clean_price, 4) : '',
    dirty_price: row.dirty_price ? formatPrice(row.dirty_price, 4) : '',
    settlement_amount: row.settlement_amount ? formatCurrency(row.settlement_amount, 2) : '',
    maturity_amount: row.maturity_amount ? formatCurrency(row.maturity_amount, 2) : '',
    amount: formatCurrency(row.amount || row.settlement_amount || row.maturity_amount || row.face_value, 2)
  }));
  
  return {
    data: formattedResults,
    total: total
  };
};

