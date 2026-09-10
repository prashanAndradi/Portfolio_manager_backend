const db = require('../config/db');

const LimitSetup = {
  getAllCounterparties: async () => {
    const sql = `
      SELECT id, short_name COLLATE utf8mb4_unicode_ci AS name, 'individual' AS type FROM counterparty_master_individual
      UNION ALL
      SELECT id, short_name COLLATE utf8mb4_unicode_ci AS name, 'joint' AS type FROM counterparty_master_joint
      UNION ALL
      SELECT id, short_name COLLATE utf8mb4_unicode_ci AS name, 'corporate' AS type FROM counterparty_master_corporate
      ORDER BY name
    `;
    const [rows] = await db.query(sql);
    return rows;
  },
  create: async (data) => {
    const sql = `INSERT INTO counterparty_limits (
      counterparty_id, counterparty_type, overall_exposure_limit, currency_limit,
      product_money_market_limit, product_fx_limit, product_derivative_limit, product_repo_limit,
      product_reverse_repo_limit, product_gsec_limit, product_sell_and_buy_back_limit, product_buy_and_sell_back_limit,
      tenor_limit, settlement_risk_limit, country_limit, group_limit, intraday_limit, product_transaction_limit, currency
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [
      data.counterparty_id,
      data.counterparty_type,
      data.overall_exposure_limit,
      data.currency_limit,
      data.product_money_market_limit,
      data.product_fx_limit,
      data.product_derivative_limit,
      data.product_repo_limit,
      data.product_reverse_repo_limit,
      data.product_gsec_limit,
      data.product_sell_and_buy_back_limit,
      data.product_buy_and_sell_back_limit,
      data.tenor_limit,
      data.settlement_risk_limit,
      data.country_limit,
      data.group_limit,
      data.intraday_limit,
      data.product_transaction_limit,
      data.currency || 'LKR'
    ];
    const [result] = await db.query(sql, values);
    return result;
  },

  // --- Middle Office approval workflow -------------------------------------
  // A middle_office_user's submission is staged in counterparty_limit_proposals
  // rather than written straight to counterparty_limits. Officers/managers
  // approve (which performs the real insert) or reject it.

  proposeLimit: async ({ counterparty_id, counterparty_type, payload, proposed_by }) => {
    const [result] = await db.query(
      `INSERT INTO counterparty_limit_proposals
         (counterparty_id, counterparty_type, payload, status, proposed_by, proposed_at)
       VALUES (?, ?, ?, 'pending', ?, NOW())`,
      [counterparty_id, counterparty_type, JSON.stringify(payload), proposed_by]
    );
    return result;
  },

  getPendingProposals: async () => {
    const [rows] = await db.query(`
      SELECT p.id, p.counterparty_id, p.counterparty_type, p.payload,
             p.proposed_by, p.proposed_at, u.username AS proposed_by_name
      FROM counterparty_limit_proposals p
      LEFT JOIN users u ON u.id = p.proposed_by
      WHERE p.status = 'pending'
      ORDER BY p.proposed_at DESC
    `);
    // mysql2 returns JSON columns already parsed on some driver versions and
    // as a string on others - normalise so callers always get an object.
    return rows.map((r) => ({
      ...r,
      payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload
    }));
  },

  // Full request history for the blotter. `proposedBy` scopes the list to one
  // submitter (a plain middle_office_user only sees their own requests).
  getProposals: async ({ status, proposedBy } = {}) => {
    const where = [];
    const params = [];
    if (status && status !== 'all') {
      where.push('p.status = ?');
      params.push(status);
    }
    if (proposedBy) {
      where.push('p.proposed_by = ?');
      params.push(proposedBy);
    }
    const [rows] = await db.query(`
      SELECT p.id, p.counterparty_id, p.counterparty_type, p.payload, p.status,
             p.proposed_by, p.proposed_at, p.approved_by, p.approved_at,
             p.rejected_by, p.rejected_at, p.rejection_reason, p.created_limit_id,
             pu.username AS proposed_by_name,
             au.username AS approved_by_name,
             ru.username AS rejected_by_name
      FROM counterparty_limit_proposals p
      LEFT JOIN users pu ON pu.id = p.proposed_by
      LEFT JOIN users au ON au.id = p.approved_by
      LEFT JOIN users ru ON ru.id = p.rejected_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.proposed_at DESC, p.id DESC
    `, params);
    return rows.map((r) => ({
      ...r,
      payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload
    }));
  },

  getProposalById: async (id) => {
    const [rows] = await db.query(
      'SELECT * FROM counterparty_limit_proposals WHERE id = ? LIMIT 1',
      [id]
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      ...row,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
    };
  },

  // Guarded on status = 'pending' so two approvers racing can't both apply it.
  markProposalApproved: async (id, approvedBy, createdLimitId) => {
    const [result] = await db.query(
      `UPDATE counterparty_limit_proposals
       SET status = 'approved', approved_by = ?, approved_at = NOW(), created_limit_id = ?
       WHERE id = ? AND status = 'pending'`,
      [approvedBy, createdLimitId, id]
    );
    return result;
  },

  markProposalRejected: async (id, rejectedBy, reason) => {
    const [result] = await db.query(
      `UPDATE counterparty_limit_proposals
       SET status = 'rejected', rejected_by = ?, rejected_at = NOW(), rejection_reason = ?
       WHERE id = ? AND status = 'pending'`,
      [rejectedBy, reason || null, id]
    );
    return result;
  },

  getLimitsByCounterparty: async (counterpartyId, counterpartyType, currency = 'LKR') => {
    const sql = `
      SELECT * FROM counterparty_limits 
      WHERE counterparty_id = ? 
      AND counterparty_type = ?
      AND (currency = ? OR currency IS NULL OR currency = '')
    `;
    const [rows] = await db.query(sql, [counterpartyId, counterpartyType, currency]);
    const row = rows[0];
    if (!row) return undefined;
    // If all relevant fields are null, treat as no limits
    const allFieldsNull = Object.values(row).every(v => v === null);
    if (allFieldsNull) return undefined;
    return row;
  },

  // Check if a transaction would exceed product-specific or overall limits
  checkTransactionLimit: async (counterpartyId, counterpartyType, productType, amount, currency = 'LKR') => {
    // Get current limit setup for this counterparty
    const limits = await LimitSetup.getLimitsByCounterparty(counterpartyId, counterpartyType, currency);
    
    if (!limits) {
      console.log('[LimitCheck] No limits found for', { counterpartyId, counterpartyType, productType, currency, amount });
      return {
        allowed: true,
        message: 'No limits configured for this counterparty/product/currency, allowing transaction by default.'
      };
    }
    
    // Get current exposure for this counterparty in this product
    const [productExposureRows] = await db.query(
      `SELECT SUM(amount) AS total FROM transactions 
       WHERE counterparty_id = ? AND transaction_type_id IN 
       (SELECT id FROM transaction_types WHERE product_type = ?) AND currency = ?`,
      [counterpartyId, productType, currency]
    );
    const currentProductExposure = parseFloat(productExposureRows[0]?.total || 0);
    
    // Get overall exposure across all products
    const [overallExposureRows] = await db.query(
      `SELECT SUM(amount) AS total FROM transactions 
       WHERE counterparty_id = ? AND currency = ?`,
      [counterpartyId, currency]
    );
    const currentOverallExposure = parseFloat(overallExposureRows[0]?.total || 0);
    
    // Check product-specific limit
    let productLimitField = '';
    console.log('[LimitCheck] Limits found:', limits);
    switch (productType) {
      case 'transaction':
        productLimitField = 'product_transaction_limit';
        break;
      case 'money_market':
        productLimitField = 'product_money_market_limit';
        break;
      case 'fx':
        productLimitField = 'product_fx_limit';
        break;
      case 'derivative':
        productLimitField = 'product_derivative_limit';
        break;
      case 'repo':
        productLimitField = 'product_repo_limit';
        break;
      case 'reverse_repo':
        productLimitField = 'product_reverse_repo_limit';
        break;
      case 'gsec':
        productLimitField = 'product_gsec_limit';
        break;
      case 'sell_and_buy_back':
        productLimitField = 'product_sell_and_buy_back_limit';
        break;
      case 'buy_and_sell_back':
        productLimitField = 'product_buy_and_sell_back_limit';
        break;
      default:
        console.log('[LimitCheck] Unknown product type:', productType, '- allowing transaction by default.');
        return {
          allowed: true,
          message: 'Unknown product type, allowing transaction by default.'
        };
    }
    
    // If no limits are set for this counterparty/product/currency, allow unlimited
    if (!limits) {
      console.log('[LimitCheck] No limits found for', { counterpartyId, counterpartyType, productType, currency, amount });
      return {
        allowed: true,
        message: 'No limits configured for this counterparty/product/currency, allowing transaction by default.'
      };
    }

    const productLimit = parseFloat(limits[productLimitField] || 0);
    const overallLimit = parseFloat(limits.overall_exposure_limit || 0);
    console.log('[LimitCheck] Product/Overall Limits:', { productLimitField, productLimit, overallLimit, currentProductExposure, currentOverallExposure, amount });
    
    // Check if adding the new amount would exceed either limit
    const newProductExposure = currentProductExposure + parseFloat(amount);
    const newOverallExposure = currentOverallExposure + parseFloat(amount);
    if ((productLimit > 0 && newProductExposure > productLimit) || (overallLimit > 0 && newOverallExposure > overallLimit)) {
      console.log('[LimitCheck] Transaction limit exceeded', { newProductExposure, productLimit, newOverallExposure, overallLimit });
      return {
        allowed: false,
        message: 'Transaction limit exceeded',
        currentExposure: { product: currentProductExposure, overall: currentOverallExposure },
        limit: { product: productLimit, overall: overallLimit },
        exceededAmount: { product: newProductExposure - productLimit, overall: newOverallExposure - overallLimit }
      };
    }
    
    if (overallLimit > 0 && newOverallExposure > overallLimit) {
      return {
        allowed: false,
        message: `Transaction exceeds overall exposure limit (${newOverallExposure} > ${overallLimit})`,
        currentExposure: currentOverallExposure,
        limit: overallLimit,
        exceededAmount: newOverallExposure - overallLimit
      };
    }
    
    return { allowed: true };
  }
};

module.exports = LimitSetup;
