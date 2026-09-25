const db = require('../config/db');
const { resolveTransactionDateRange, appendValueDateRange } = require('./reportViewHelper');

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

exports.getCounterpartyReport = async ({ counterparty, nicNumber, name, dateFrom, dateTo, page, pageSize }) => {
  const range = resolveTransactionDateRange({ dateFrom, dateTo });
  const hasDateRange = Boolean(range.from || range.to);
  console.log(`[Counterparty Report] Called with counterparty: ${counterparty}, nicNumber: ${nicNumber}, name: ${name}, dateFrom: ${range.from || ''}, dateTo: ${range.to || ''}`);
  
  try {
    // Build WHERE conditions for each table
    let individualWhere = [];
    let jointWhere = [];
    let corporateWhere = [];
    let individualParams = [];
    let jointParams = [];
    let corporateParams = [];
    
    if (counterparty) {
      // Extract type and id from unique_id (e.g., 'i1', 'j1', 'c1')
      // Handle cases where value might be encoded or have extra characters
      const cleanCounterparty = counterparty.trim();
      const type = cleanCounterparty.charAt(0);
      const idStr = cleanCounterparty.substring(1);
      // Remove any trailing characters after the ID (e.g., ':1' in 'i7:1')
      const id = idStr.split(':')[0].split('&')[0];
      const idNum = parseInt(id, 10);
      
      if (isNaN(idNum)) {
        console.warn(`[Counterparty Report] Invalid counterparty ID: ${id} from ${counterparty}`);
      } else {
        if (type === 'i') {
          individualWhere.push('id = ?');
          individualParams.push(idNum);
        } else if (type === 'j') {
          jointWhere.push('id = ?');
          jointParams.push(idNum);
        } else if (type === 'c') {
          corporateWhere.push('id = ?');
          corporateParams.push(idNum);
        }
      }
    }
    
    // Build filter conditions
    // NIC filter: only applies to individual counterparties (they have id_number)
    // Name filter: applies to all types (short_name, long_name, company_name)
    // When both NIC and name are provided, use OR logic (match NIC OR match name)
    
    const individualFilters = [];
    const jointFilters = [];
    const corporateFilters = [];
    
    if (nicNumber) {
      individualFilters.push('id_number LIKE ?');
      individualParams.push(`%${nicNumber}%`);
    }
    
    if (name) {
      individualFilters.push('(long_name LIKE ? OR short_name LIKE ?)');
      individualParams.push(`%${name}%`, `%${name}%`);
      jointFilters.push('(long_name LIKE ? OR short_name LIKE ?)');
      jointParams.push(`%${name}%`, `%${name}%`);
      corporateFilters.push('(long_name LIKE ? OR company_name LIKE ? OR short_name LIKE ?)');
      corporateParams.push(`%${name}%`, `%${name}%`, `%${name}%`);
    }
    
    // Combine counterparty filter with NIC/name filters
    // If counterparty is specified, it's AND with other filters
    // If only NIC/name filters, they use OR between them
    let individualWhereClause = '';
    let jointWhereClause = '';
    let corporateWhereClause = '';
    
    // Individual: counterparty filter (if any) + NIC/name filters
    const allIndividualFilters = [...individualWhere, ...individualFilters];
    if (allIndividualFilters.length > 0) {
      if (allIndividualFilters.length === 1) {
        individualWhereClause = 'WHERE ' + allIndividualFilters[0];
      } else {
        // If counterparty filter exists, use AND; otherwise use OR for NIC/name
        if (individualWhere.length > 0 && individualFilters.length > 0) {
          // Counterparty AND (NIC OR name)
          individualWhereClause = `WHERE ${individualWhere[0]} AND (${individualFilters.join(' OR ')})`;
        } else if (individualFilters.length > 1) {
          // Multiple name filters (shouldn't happen, but handle it)
          individualWhereClause = 'WHERE ' + individualFilters.join(' OR ');
        } else {
          // Single filter
          individualWhereClause = 'WHERE ' + allIndividualFilters.join(' OR ');
        }
      }
    }
    
    // Joint: counterparty filter (if any) + name filter
    const allJointFilters = [...jointWhere, ...jointFilters];
    if (allJointFilters.length > 0) {
      if (allJointFilters.length === 1) {
        jointWhereClause = 'WHERE ' + allJointFilters[0];
      } else {
        // Joint only has name filter, so if counterparty exists, use AND
        jointWhereClause = 'WHERE ' + allJointFilters.join(' AND ');
      }
    }
    
    // Corporate: counterparty filter (if any) + name filter
    const allCorporateFilters = [...corporateWhere, ...corporateFilters];
    if (allCorporateFilters.length > 0) {
      if (allCorporateFilters.length === 1) {
        corporateWhereClause = 'WHERE ' + allCorporateFilters[0];
      } else {
        // Corporate only has name filter, so if counterparty exists, use AND
        corporateWhereClause = 'WHERE ' + allCorporateFilters.join(' AND ');
      }
    }
    
    // Build queries with proper parameter handling
    // Build individual query with COLLATE to fix collation mismatch
    const individualQuery = `
      SELECT 
        CONCAT('i', id) AS unique_id,
        'individual' AS cp_type,
        id AS cp_id,
        short_name COLLATE utf8mb4_unicode_ci AS short_name,
        long_name COLLATE utf8mb4_unicode_ci AS long_name,
        NULL AS company_name,
        id_number COLLATE utf8mb4_unicode_ci AS nic_number,
        cux_number COLLATE utf8mb4_unicode_ci AS cux_number,
        title COLLATE utf8mb4_unicode_ci AS title,
        id_type COLLATE utf8mb4_unicode_ci AS id_type,
        house_number COLLATE utf8mb4_unicode_ci AS house_number,
        street_name COLLATE utf8mb4_unicode_ci AS street_name,
        city COLLATE utf8mb4_unicode_ci AS city,
        province COLLATE utf8mb4_unicode_ci AS province,
        postal_code COLLATE utf8mb4_unicode_ci AS postal_code,
        country COLLATE utf8mb4_unicode_ci AS country,
        telephone COLLATE utf8mb4_unicode_ci AS telephone,
        email COLLATE utf8mb4_unicode_ci AS email,
        mobile COLLATE utf8mb4_unicode_ci AS mobile,
        custodian_bank COLLATE utf8mb4_unicode_ci AS custodian_bank,
        cds_account COLLATE utf8mb4_unicode_ci AS cds_account
      FROM counterparty_master_individual
      ${individualWhereClause}
    `;
    
    // Build joint query with COLLATE
    const jointQuery = `
      SELECT 
        CONCAT('j', id) AS unique_id,
        'joint' AS cp_type,
        id AS cp_id,
        short_name COLLATE utf8mb4_unicode_ci AS short_name,
        long_name COLLATE utf8mb4_unicode_ci AS long_name,
        NULL AS company_name,
        NULL AS nic_number,
        cux_number COLLATE utf8mb4_unicode_ci AS cux_number,
        NULL AS title,
        NULL AS id_type,
        NULL AS house_number,
        NULL AS street_name,
        NULL AS city,
        NULL AS province,
        NULL AS postal_code,
        NULL AS country,
        NULL AS telephone,
        NULL AS email,
        NULL AS mobile,
        custodian_bank COLLATE utf8mb4_unicode_ci AS custodian_bank,
        cds_account COLLATE utf8mb4_unicode_ci AS cds_account
      FROM counterparty_master_joint
      ${jointWhereClause}
    `;
    
    // Build corporate query with COLLATE
    const corporateQuery = `
      SELECT 
        CONCAT('c', id) AS unique_id,
        'corporate' AS cp_type,
        id AS cp_id,
        short_name COLLATE utf8mb4_unicode_ci AS short_name,
        long_name COLLATE utf8mb4_unicode_ci AS long_name,
        company_name COLLATE utf8mb4_unicode_ci AS company_name,
        NULL AS nic_number,
        cux_number COLLATE utf8mb4_unicode_ci AS cux_number,
        NULL AS title,
        NULL AS id_type,
        NULL AS house_number,
        NULL AS street_name,
        city COLLATE utf8mb4_unicode_ci AS city,
        state COLLATE utf8mb4_unicode_ci AS province,
        postal_code COLLATE utf8mb4_unicode_ci AS postal_code,
        country COLLATE utf8mb4_unicode_ci AS country,
        phone_number COLLATE utf8mb4_unicode_ci AS telephone,
        email COLLATE utf8mb4_unicode_ci AS email,
        NULL AS mobile,
        custodian_bank COLLATE utf8mb4_unicode_ci AS custodian_bank,
        cds_account COLLATE utf8mb4_unicode_ci AS cds_account
      FROM counterparty_master_corporate
      ${corporateWhereClause}
    `;
    
    // Determine which tables to query based on filters
    let combinedQuery;
    let allParams;
    
    if (counterparty) {
      // Specific counterparty selected - only query the relevant table
      const cleanCounterparty = counterparty.trim();
      const type = cleanCounterparty.charAt(0);
      
      if (type === 'i') {
        combinedQuery = individualQuery;
        allParams = individualParams;
      } else if (type === 'j') {
        combinedQuery = jointQuery;
        allParams = jointParams;
      } else if (type === 'c') {
        combinedQuery = corporateQuery;
        allParams = corporateParams;
      } else {
        // Fallback to all tables if type is unknown
        combinedQuery = `${individualQuery} UNION ALL ${jointQuery} UNION ALL ${corporateQuery}`;
        allParams = [...individualParams, ...jointParams, ...corporateParams];
      }
    } else {
      // No specific counterparty - query tables based on filters
      const queries = [];
      const params = [];
      
      // If only NIC filter: query individual table only (NIC only applies to individuals)
      if (nicNumber && !name) {
        queries.push(individualQuery);
        params.push(...individualParams);
      } else {
        // Name filter provided OR no filters - query all tables
        queries.push(individualQuery);
        params.push(...individualParams);
        
        // Joint and Corporate only have name filter, so include them if name filter or no filters
        queries.push(jointQuery);
        params.push(...jointParams);
        queries.push(corporateQuery);
        params.push(...corporateParams);
      }
      
      combinedQuery = queries.join(' UNION ALL ');
      allParams = params;
    }
    
    console.log('[Counterparty Report] Query params:', {
      individualParams,
      jointParams,
      corporateParams,
      allParams
    });
    console.log('[Counterparty Report] Individual WHERE:', individualWhereClause);
    console.log('[Counterparty Report] Joint WHERE:', jointWhereClause);
    console.log('[Counterparty Report] Corporate WHERE:', corporateWhereClause);
    
    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM (${combinedQuery}) AS all_counterparties`;
    console.log('[Counterparty Report] Count query:', countQuery);
    console.log('[Counterparty Report] Count params:', allParams);
    
    let countResult, total, rows;
    try {
      [countResult] = await db.query(countQuery, allParams);
      total = countResult[0]?.total || 0;
    } catch (countError) {
      console.error('[Counterparty Report] Count query error:', countError);
      throw new Error(`Count query failed: ${countError.message}`);
    }
    
    // Apply pagination if provided
    let dataQuery = combinedQuery;
    let finalParams = allParams;
    if (page && pageSize) {
      const offset = (page - 1) * pageSize;
      dataQuery = `${combinedQuery} ORDER BY short_name LIMIT ? OFFSET ?`;
      finalParams = [...allParams, parseInt(pageSize), offset];
    } else {
      dataQuery = `${combinedQuery} ORDER BY short_name`;
    }
    
    console.log('[Counterparty Report] Data query:', dataQuery.substring(0, 200) + '...');
    console.log('[Counterparty Report] Data params:', finalParams);
    
    try {
      [rows] = await db.query(dataQuery, finalParams);
    } catch (dataError) {
      console.error('[Counterparty Report] Data query error:', dataError);
      throw new Error(`Data query failed: ${dataError.message}`);
    }
    
    // Format the counterparty results
    const counterparties = rows.map(row => ({
      unique_id: row.unique_id,
      cux_number: row.cux_number || '',
      short_name: row.short_name || '',
      long_name: row.long_name || '',
      company_name: row.company_name || '',
      name: row.long_name || row.company_name || row.short_name,
      type: row.cp_type || '',
      nic_number: row.nic_number || '',
      title: row.title || '',
      id_type: row.id_type || '',
      address: [
        row.house_number,
        row.street_name,
        row.city,
        row.province,
        row.postal_code,
        row.country
      ].filter(Boolean).join(', '),
      telephone: row.telephone || '',
      email: row.email || '',
      mobile: row.mobile || '',
      custodian_bank: row.custodian_bank || '',
      cds_account: row.cds_account || '',
      cp_id: row.cp_id
    }));
    
    // Now fetch all deals for these counterparties
    // Extract unique counterparty IDs for querying
    const counterpartyIds = counterparties.map(cp => cp.unique_id);
    if (counterpartyIds.length === 0) {
      return {
        data: counterparties.map(cp => ({
          short_name: cp.short_name || '',
          deal_number: '',
          deal_source: '',
          product_type: '',
          trade_date: '',
          value_date: '',
          amount: '',
          price: '',
          yield: '',
          portfolio: '',
          isin: '',
          maturity_date: '',
          status: '',
          currency: ''
        })),
        total: counterparties.length
      };
    }
    
    // Separate counterparties by type and extract IDs
    // Only use the counterparties that match the filter
    const individualIds = counterparties.filter(cp => cp.type === 'individual').map(cp => cp.cp_id);
    const jointIds = counterparties.filter(cp => cp.type === 'joint').map(cp => cp.cp_id);
    const corporateIds = counterparties.filter(cp => cp.type === 'corporate').map(cp => cp.cp_id);
    
    // If a specific counterparty is selected, only get deals for that one
    let dealCounterpartyIds = counterpartyIds;
    let dealIndividualIds = individualIds;
    let dealJointIds = jointIds;
    let dealCorporateIds = corporateIds;
    
    if (counterparty) {
      // Normalize the counterparty parameter (remove any suffixes like ":1" or "&...")
      const cleanCounterparty = counterparty.trim();
      const normalizedCounterparty = cleanCounterparty.split(':')[0].split('&')[0];
      
      // Filter to only the selected counterparty
      // Try exact match first, then normalized match
      const selectedCp = counterparties.find(cp => 
        cp.unique_id === counterparty || 
        cp.unique_id === normalizedCounterparty ||
        cp.unique_id === cleanCounterparty
      );
      
      if (selectedCp) {
        // Use the actual unique_id from the found counterparty
        dealCounterpartyIds = [selectedCp.unique_id];
        if (selectedCp.type === 'individual') {
          dealIndividualIds = [selectedCp.cp_id];
          dealJointIds = [];
          dealCorporateIds = [];
        } else if (selectedCp.type === 'joint') {
          dealIndividualIds = [];
          dealJointIds = [selectedCp.cp_id];
          dealCorporateIds = [];
        } else if (selectedCp.type === 'corporate') {
          dealIndividualIds = [];
          dealJointIds = [];
          dealCorporateIds = [selectedCp.cp_id];
        }
        console.log(`[Counterparty Report] Filtering deals for selected counterparty: ${selectedCp.unique_id} (type: ${selectedCp.type}, id: ${selectedCp.cp_id})`);
      } else {
        console.warn(`[Counterparty Report] Selected counterparty ${counterparty} not found in results`);
      }
    }
    
    let allDeals = [];
    
    // Query transactions table (uses unique_id format)
    if (dealCounterpartyIds.length > 0) {
      try {
        const transQuery = `
          SELECT 
            'Transaction' AS deal_source,
            t.deal_number,
            t.trade_date,
            t.value_date,
            t.amount,
            t.price,
            t.yield,
            t.portfolio,
            t.status,
            t.currency,
            t.counterparty_id AS counterparty_ref,
            NULL AS isin,
            NULL AS maturity_date,
            'Transaction' AS product_type
          FROM transactions t
          WHERE t.counterparty_id IN (${dealCounterpartyIds.map(() => '?').join(',')})
        `;
        const transParams = [...dealCounterpartyIds];
        transQuery = appendValueDateRange(transQuery, transParams, 't.value_date', range);
        const [transRows] = await db.query(transQuery, transParams);
        allDeals = allDeals.concat(transRows);
      } catch (err) {
        console.error('[Counterparty Report] Error fetching transactions:', err);
      }
    }
    
    // Query gsec table (uses unique_id format)
    if (dealCounterpartyIds.length > 0) {
      try {
        const gsecQuery = `
          SELECT 
            'GSec' AS deal_source,
            g.deal_number,
            g.trade_date,
            g.value_date,
            g.face_value AS amount,
            g.clean_price AS price,
            g.yield,
            g.portfolio,
            g.status,
            g.currency,
            g.counterparty AS counterparty_ref,
            g.isin,
            g.maturity_date,
            'GSec' AS product_type
          FROM gsec g
          WHERE g.counterparty IN (${dealCounterpartyIds.map(() => '?').join(',')})
        `;
        const gsecParams = [...dealCounterpartyIds];
        gsecQuery = appendValueDateRange(gsecQuery, gsecParams, 'g.value_date', range);
        const [gsecRows] = await db.query(gsecQuery, gsecParams);
        allDeals = allDeals.concat(gsecRows);
      } catch (err) {
        console.error('[Counterparty Report] Error fetching gsec deals:', err);
      }
    }
    
    // Query money_market_deals (uses counterparty_id + counterparty_type)
    const mmConditions = [];
    const mmParams = [];
    if (dealIndividualIds.length > 0) {
      mmConditions.push(`(mmd.counterparty_type = 'individual' AND mmd.counterparty_id IN (${dealIndividualIds.map(() => '?').join(',')}))`);
      mmParams.push(...dealIndividualIds);
    }
    if (dealJointIds.length > 0) {
      mmConditions.push(`(mmd.counterparty_type = 'joint' AND mmd.counterparty_id IN (${dealJointIds.map(() => '?').join(',')}))`);
      mmParams.push(...dealJointIds);
    }
    if (dealCorporateIds.length > 0) {
      mmConditions.push(`(mmd.counterparty_id IN (${dealCorporateIds.map(() => '?').join(',')}) AND (mmd.counterparty_type = 'corporate' OR mmd.counterparty_type IS NULL))`);
      mmParams.push(...dealCorporateIds);
    }
    
    if (mmConditions.length > 0) {
      try {
        const mmQuery = `
          SELECT 
            'Money Market' AS deal_source,
            mmd.deal_number,
            mmd.trade_date,
            mmd.value_date,
            mmd.principal_amount AS amount,
            NULL AS price,
            mmd.interest_rate AS yield,
            NULL AS portfolio,
            mmd.status,
            mmd.currency,
            CONCAT(COALESCE(mmd.counterparty_type, 'c'), mmd.counterparty_id) AS counterparty_ref,
            NULL AS isin,
            mmd.maturity_date,
            'Money Market' AS product_type
          FROM money_market_deals mmd
          WHERE ${mmConditions.join(' OR ')}
        `;
        mmQuery = appendValueDateRange(mmQuery, mmParams, 'mmd.value_date', range);
        const [mmRows] = await db.query(mmQuery, mmParams);
        allDeals = allDeals.concat(mmRows);
      } catch (err) {
        console.error('[Counterparty Report] Error fetching money market deals:', err);
      }
    }
    
    // Query buyback_deals (uses unique_id format for both legs)
    if (dealCounterpartyIds.length > 0) {
      try {
        // Get leg1 deals
        const buybackQuery1 = `
          SELECT 
            'Buyback' AS deal_source,
            bd.deal_number,
            bd.leg1_trade_date AS trade_date,
            bd.leg1_value_date AS value_date,
            bd.leg1_face_value AS amount,
            bd.leg1_clean_price AS price,
            bd.leg1_yield_rate AS yield,
            bd.leg1_portfolio AS portfolio,
            bd.deal_status AS status,
            bd.leg1_currency AS currency,
            bd.leg1_counterparty AS counterparty_ref,
            bd.leg1_isin AS isin,
            NULL AS maturity_date,
            'Buyback (Leg1)' AS product_type
          FROM buyback_deals bd
          WHERE bd.leg1_counterparty IN (${dealCounterpartyIds.map(() => '?').join(',')})
        `;
        const buybackParams1 = [...dealCounterpartyIds];
        buybackQuery1 = appendValueDateRange(buybackQuery1, buybackParams1, 'bd.leg1_value_date', range);
        const [buybackRows1] = await db.query(buybackQuery1, buybackParams1);
        allDeals = allDeals.concat(buybackRows1);
        
        // Get leg2 deals
        const buybackQuery2 = `
          SELECT 
            'Buyback' AS deal_source,
            bd.deal_number,
            bd.leg2_trade_date AS trade_date,
            bd.leg2_value_date AS value_date,
            bd.leg2_face_value AS amount,
            bd.leg2_clean_price AS price,
            bd.leg2_yield_rate AS yield,
            bd.leg2_portfolio AS portfolio,
            bd.deal_status AS status,
            bd.leg2_currency AS currency,
            bd.leg2_counterparty AS counterparty_ref,
            bd.leg2_isin AS isin,
            NULL AS maturity_date,
            'Buyback (Leg2)' AS product_type
          FROM buyback_deals bd
          WHERE bd.leg2_counterparty IN (${dealCounterpartyIds.map(() => '?').join(',')})
        `;
        const buybackParams2 = [...dealCounterpartyIds];
        buybackQuery2 = appendValueDateRange(buybackQuery2, buybackParams2, 'bd.leg2_value_date', range);
        const [buybackRows2] = await db.query(buybackQuery2, buybackParams2);
        allDeals = allDeals.concat(buybackRows2);
      } catch (err) {
        console.error('[Counterparty Report] Error fetching buyback deals:', err);
      }
    }
    
    // Query repo_deals
    // Note: repo_deals may or may not have counterparty_type column depending on migration
    // We'll query by counterparty_id only and map the type in JavaScript
    const allRepoCounterpartyIds = [...dealIndividualIds, ...dealJointIds, ...dealCorporateIds];
    
    if (allRepoCounterpartyIds.length > 0) {
      try {
        // Query repo deals by counterparty_id only (works whether or not counterparty_type exists)
        const repoQuery = `
          SELECT 
            'Repo' AS deal_source,
            rd.deal_number AS deal_number,
            rd.trade_date,
            rd.value_date,
            rd.principal_amount AS amount,
            NULL AS price,
            rd.rate AS yield,
            NULL AS portfolio,
            rd.status,
            'LKR' AS currency,
            rd.counterparty_id,
            rd.isin_number AS isin,
            rd.maturity_date,
            rd.deal_type AS product_type
          FROM repo_deals rd
          WHERE rd.counterparty_id IN (${allRepoCounterpartyIds.map(() => '?').join(',')})
        `;
        const repoParams = [...allRepoCounterpartyIds];
        repoQuery = appendValueDateRange(repoQuery, repoParams, 'rd.value_date', range);
        const [repoRows] = await db.query(repoQuery, repoParams);
        
        // Map results to include correct counterparty_ref based on which ID array the counterparty_id belongs to
        const mappedRepoRows = repoRows.map(row => {
          const cpId = row.counterparty_id;
          let cpType = 'c'; // default to corporate
          
          if (dealIndividualIds.includes(cpId)) {
            cpType = 'i';
          } else if (dealJointIds.includes(cpId)) {
            cpType = 'j';
          } else if (dealCorporateIds.includes(cpId)) {
            cpType = 'c';
          }
          
          return {
            deal_source: row.deal_source,
            deal_number: row.deal_number,
            trade_date: row.trade_date,
            value_date: row.value_date,
            amount: row.amount,
            price: row.price,
            yield: row.yield,
            portfolio: row.portfolio,
            status: row.status,
            currency: row.currency,
            counterparty_ref: `${cpType}${cpId}`,
            isin: row.isin,
            maturity_date: row.maturity_date,
            product_type: row.product_type
          };
        });
        
        allDeals = allDeals.concat(mappedRepoRows);
      } catch (err) {
        console.error('[Counterparty Report] Error fetching repo deals:', err);
      }
    }
    
    console.log(`[Counterparty Report] Found ${allDeals.length} total deals for counterparties`);
    
    // Combine counterparty data with their deals
    // Create a map of counterparty to deals
    const dealsByCounterparty = {};
    allDeals.forEach(deal => {
      const cpRef = deal.counterparty_ref;
      if (!dealsByCounterparty[cpRef]) {
        dealsByCounterparty[cpRef] = [];
      }
      dealsByCounterparty[cpRef].push(deal);
    });
    
    // If a specific counterparty is selected, filter to only that one
    let counterpartiesToProcess = counterparties;
    if (counterparty) {
      const cleanCounterparty = counterparty.trim();
      const normalizedCounterparty = cleanCounterparty.split(':')[0].split('&')[0];
      counterpartiesToProcess = counterparties.filter(cp => 
        cp.unique_id === counterparty || 
        cp.unique_id === normalizedCounterparty ||
        cp.unique_id === cleanCounterparty
      );
      console.log(`[Counterparty Report] Filtered to ${counterpartiesToProcess.length} counterparty(ies) from ${counterparties.length} total`);
    }
    
    // Create result rows: one row per counterparty-deal combination
    // If a counterparty has no deals, still include them with empty deal fields
    const formattedResults = [];
    
    counterpartiesToProcess.forEach(cp => {
      const deals = dealsByCounterparty[cp.unique_id] || [];
      
      if (deals.length === 0) {
        // A date range means this is a transaction blotter: skip counterparties
        // with no deals in the selected window.
        if (hasDateRange) return;
        // Counterparty with no deals - still show them
        formattedResults.push({
          short_name: cp.short_name || '',
          deal_number: '',
          deal_source: '',
          product_type: '',
          trade_date: '',
          value_date: '',
          amount: '',
          price: '',
          yield: '',
          portfolio: '',
          isin: '',
          maturity_date: '',
          status: '',
          currency: ''
        });
      } else {
        // Create one row per deal
        deals.forEach(deal => {
          formattedResults.push({
            short_name: cp.short_name || '',
            deal_number: deal.deal_number || '',
            deal_source: deal.deal_source || '',
            product_type: deal.product_type || '',
            trade_date: deal.trade_date ? formatDate(deal.trade_date) : '',
            value_date: deal.value_date ? formatDate(deal.value_date) : '',
            amount: deal.amount || '',
            price: deal.price || '',
            yield: deal.yield || '',
            portfolio: deal.portfolio || '',
            isin: deal.isin || '',
            maturity_date: deal.maturity_date ? formatDate(deal.maturity_date) : '',
            status: deal.status || '',
            currency: deal.currency || ''
          });
        });
      }
    });
    
    console.log(`[Counterparty Report] Returning ${formattedResults.length} results (${counterpartiesToProcess.length} counterparty(ies) with ${allDeals.length} total deals)`);
    
    return {
      data: formattedResults,
      total: formattedResults.length
    };
  } catch (error) {
    console.error('[Counterparty Report] Error:', error);
    throw error;
  }
};

// Get all counterparty master details for comprehensive report
exports.getAllCounterpartyMasterDetails = async ({ type, page, pageSize }) => {
  try {
    console.log(`[Counterparty Master Report] Fetching all counterparty details, type: ${type || 'all'}`);
    
    const queries = [];
    const params = [];
    
    // Build queries for each type
    if (!type || type === 'all' || type === 'individual') {
      queries.push(`
        SELECT 
          CONCAT('i', id) AS unique_id,
          'Individual' AS counterparty_type,
          id AS cp_id,
          cux_number,
          title,
          short_name,
          long_name,
          id_type,
          id_number AS nic_number,
          house_number,
          street_name,
          city,
          province,
          postal_code,
          country,
          telephone,
          email,
          mobile,
          custodian_bank,
          cds_account,
          NULL AS company_name,
          NULL AS registration_number,
          NULL AS tin_number,
          NULL AS vat_number
        FROM counterparty_master_individual
      `);
    }
    
    if (!type || type === 'all' || type === 'joint') {
      queries.push(`
        SELECT 
          CONCAT('j', id) AS unique_id,
          'Joint' AS counterparty_type,
          id AS cp_id,
          cux_number,
          title,
          short_name,
          long_name,
          id_type,
          NULL AS nic_number,
          NULL AS house_number,
          NULL AS street_name,
          NULL AS city,
          NULL AS province,
          NULL AS postal_code,
          NULL AS country,
          NULL AS telephone,
          NULL AS email,
          NULL AS mobile,
          custodian_bank,
          cds_account,
          NULL AS company_name,
          NULL AS registration_number,
          NULL AS tin_number,
          NULL AS vat_number
        FROM counterparty_master_joint
      `);
    }
    
    if (!type || type === 'all' || type === 'corporate') {
      queries.push(`
        SELECT 
          CONCAT('c', id) AS unique_id,
          'Corporate' AS counterparty_type,
          id AS cp_id,
          cux_number,
          NULL AS title,
          short_name,
          long_name,
          NULL AS id_type,
          NULL AS nic_number,
          NULL AS house_number,
          NULL AS street_name,
          city,
          state AS province,
          postal_code,
          country,
          phone_number AS telephone,
          email,
          NULL AS mobile,
          custodian_bank,
          cds_account,
          company_name,
          registration_number,
          tin_number,
          vat_number
        FROM counterparty_master_corporate
      `);
    }
    
    if (queries.length === 0) {
      return { data: [], total: 0 };
    }
    
    const combinedQuery = queries.join(' UNION ALL ');
    
    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM (${combinedQuery}) AS all_counterparties`;
    const [countResult] = await db.query(countQuery);
    const total = countResult[0]?.total || 0;
    
    // Apply pagination if provided
    let dataQuery = combinedQuery;
    let finalParams = [];
    if (page && pageSize) {
      const offset = (page - 1) * pageSize;
      dataQuery = `${combinedQuery} ORDER BY counterparty_type, short_name LIMIT ? OFFSET ?`;
      finalParams = [parseInt(pageSize), offset];
    } else {
      dataQuery = `${combinedQuery} ORDER BY counterparty_type, short_name`;
    }
    
    const [rows] = await db.query(dataQuery, finalParams);
    
    // Format the results
    const formattedResults = rows.map(row => ({
      unique_id: row.unique_id || '',
      counterparty_type: row.counterparty_type || '',
      cux_number: row.cux_number || '',
      title: row.title || '',
      short_name: row.short_name || '',
      long_name: row.long_name || '',
      company_name: row.company_name || '',
      id_type: row.id_type || '',
      nic_number: row.nic_number || '',
      registration_number: row.registration_number || '',
      tin_number: row.tin_number || '',
      vat_number: row.vat_number || '',
      address: [
        row.house_number,
        row.street_name,
        row.city,
        row.province,
        row.postal_code,
        row.country
      ].filter(Boolean).join(', ') || '',
      telephone: row.telephone || '',
      email: row.email || '',
      mobile: row.mobile || '',
      custodian_bank: row.custodian_bank || '',
      cds_account: row.cds_account || ''
    }));
    
    console.log(`[Counterparty Master Report] Returning ${formattedResults.length} results (total: ${total})`);
    
    return {
      data: formattedResults,
      total
    };
  } catch (error) {
    console.error('[Counterparty Master Report] Error:', error);
    throw error;
  }
};