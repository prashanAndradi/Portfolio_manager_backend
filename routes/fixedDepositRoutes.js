const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { checkAuth } = require('../middleware/auth');
const { resolveEffectiveWorkflowAuth } = require('../utils/effectiveWorkflowAuth');
const { resolveRequestUserId } = require('../utils/requestUser');

// Fixed Deposit approval is single-tier (back_office_final only, no
// intermediate verifier). Shared guard for both /approve and /reject below -
// without it, any authenticated user could approve or reject any request
// regardless of role, and a request could be re-approved/re-rejected after
// it already left the pending state.
async function requireFdApprover(req, res, id) {
  const actor = await resolveEffectiveWorkflowAuth(resolveRequestUserId(req));
  if (!actor) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  if (!actor.isAdmin && !actor.allowedTabs.includes('fixed_deposit')) {
    res.status(403).json({ error: 'Access denied: Fixed Deposit not assigned' });
    return null;
  }
  if (!actor.isAdmin && actor.role !== 'back_office_final') {
    res.status(403).json({ error: 'Access denied: back_office_final role required' });
    return null;
  }
  const [rows] = await db.query('SELECT status FROM fixed_deposit_requests WHERE id = ?', [id]);
  if (!rows.length) {
    res.status(404).json({ error: 'Request not found' });
    return null;
  }
  if (String(rows[0].status || '').trim().toLowerCase() !== 'pending') {
    res.status(400).json({ error: `Cannot act on request: current status is ${rows[0].status}, not pending.` });
    return null;
  }
  return actor;
}

/**
 * Get FD deals that can fund "part amount" - matured (approved, final_approved, maturity_date <= today) or pre-approved
 * GET /api/fixed-deposit/fund-movement-sources
 */
router.get('/fund-movement-sources', checkAuth, async (req, res) => {
  try {
    const { counterparty } = req.query;
    // Matured: status=Approved, current_approval_level=final_approved, maturity_date <= CURDATE()
    let maturedSql = `
      SELECT 
        fdr.id,
        fdr.request_no as deal_number,
        fdr.requested_amount as face_value,
        fdr.maturity_date,
        COALESCE(corp.short_name, ind.short_name, joint.short_name, fdr.counterparty_id) as counterparty_name,
        'fixed_deposit' as product_type,
        'matured' as source_type
      FROM fixed_deposit_requests fdr
      LEFT JOIN counterparty_master_corporate corp ON fdr.counterparty_id = corp.id
      LEFT JOIN counterparty_master_individual ind ON fdr.counterparty_id = ind.id
      LEFT JOIN counterparty_master_joint joint ON fdr.counterparty_id = joint.id
      WHERE fdr.status = 'Approved'
        AND fdr.current_approval_level = 'final_approved'
        AND fdr.maturity_date <= CURDATE()
    `;
    const maturedParams = [];
    if (counterparty) {
      maturedSql += ` AND (fdr.counterparty_id LIKE ? OR corp.short_name LIKE ? OR ind.short_name LIKE ? OR joint.short_name LIKE ?)`;
      const cpPattern = `%${counterparty}%`;
      maturedParams.push(cpPattern, cpPattern, cpPattern, cpPattern);
    }
    maturedSql += ` ORDER BY fdr.maturity_date ASC`;

    // Pre-approved: pre_approval_status = 'pre_approved'
    let preApprovedSql = `
      SELECT 
        fdr.id,
        fdr.request_no as deal_number,
        fdr.requested_amount as face_value,
        fdr.maturity_date,
        COALESCE(corp.short_name, ind.short_name, joint.short_name, fdr.counterparty_id) as counterparty_name,
        'fixed_deposit' as product_type,
        'pre_approved' as source_type
      FROM fixed_deposit_requests fdr
      LEFT JOIN counterparty_master_corporate corp ON fdr.counterparty_id = corp.id
      LEFT JOIN counterparty_master_individual ind ON fdr.counterparty_id = ind.id
      LEFT JOIN counterparty_master_joint joint ON fdr.counterparty_id = joint.id
      WHERE fdr.pre_approval_status = 'pre_approved'
    `;
    const preApprovedParams = [];
    if (counterparty) {
      preApprovedSql += ` AND (fdr.counterparty_id LIKE ? OR corp.short_name LIKE ? OR ind.short_name LIKE ? OR joint.short_name LIKE ?)`;
      const cpPattern = `%${counterparty}%`;
      preApprovedParams.push(cpPattern, cpPattern, cpPattern, cpPattern);
    }
    preApprovedSql += ` ORDER BY fdr.maturity_date ASC`;

    const [maturedRows] = await db.query(maturedSql, maturedParams);
    const [preApprovedRows] = await db.query(preApprovedSql, preApprovedParams);
    const data = [...maturedRows, ...preApprovedRows];
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching fund movement sources:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch fund movement sources', details: error.message });
  }
});

/**
 * Get all Fixed Deposit requests with optional status filter
 * GET /api/fixed-deposit/requests?status=Pending
 */
router.get('/requests', checkAuth, async (req, res) => {
  try {
    const { status, file_number, file_number_like } = req.query;
    
    let query = `
      SELECT 
        fd.*,
        COALESCE(
          corp.short_name,
          ind.short_name,
          joint.short_name,
          CONCAT('ID:', fd.counterparty_id)
        ) as counterparty_name,
        COALESCE(
          corp.long_name,
          ind.long_name,
          joint.long_name,
          corp.company_name,
          NULL
        ) as counterparty_long_name,
        p.portfolio_name as portfolio_name,
        u.username as submitted_by_name
      FROM fixed_deposit_requests fd
      LEFT JOIN counterparty_master_corporate corp ON fd.counterparty_id = corp.id
      LEFT JOIN counterparty_master_individual ind ON fd.counterparty_id = ind.id
      LEFT JOIN counterparty_master_joint joint ON fd.counterparty_id = joint.id
      LEFT JOIN portfolio_master p ON CAST(fd.portfolio_id AS CHAR) COLLATE utf8mb4_unicode_ci = CAST(p.portfolio_id AS CHAR) COLLATE utf8mb4_unicode_ci
      LEFT JOIN users u ON fd.submitted_by = u.id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (status && status !== 'All') {
      // Handle case-insensitive status matching - use the table's collation
      query += ` AND fd.status COLLATE utf8mb4_0900_ai_ci = ? COLLATE utf8mb4_0900_ai_ci`;
      params.push(status);
    }
    
    if (file_number) {
      query += ` AND fd.file_number = ?`;
      params.push(file_number);
    }
    
    if (file_number_like) {
      query += ` AND fd.file_number LIKE ?`;
      params.push(`%${file_number_like}%`);
    }
    
    query += ` ORDER BY fd.created_at DESC`;
    
    const [requests] = await db.query(query, params);
    
    console.log(`Fetched ${requests.length} fixed deposit requests for status: ${status || 'All'}`);
    res.json(requests);
  } catch (error) {
    console.error('Error fetching fixed deposit requests:', error);
    console.error('Error details:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch fixed deposit requests', details: error.message });
  }
});

/**
 * Get pending fixed deposit requests for authorizer
 * GET /api/fixed-deposit/requests/pending
 * NOTE: This route must come before /requests/:id to avoid route conflicts
 */
router.get('/requests/pending', checkAuth, async (req, res) => {
  try {
    const [requests] = await db.query(
      `SELECT 
        fd.*,
        COALESCE(
          corp.short_name,
          ind.short_name,
          joint.short_name,
          CONCAT('ID:', fd.counterparty_id)
        ) as counterparty_name,
        COALESCE(
          corp.long_name,
          ind.long_name,
          joint.long_name,
          corp.company_name,
          NULL
        ) as counterparty_long_name,
        p.portfolio_name as portfolio_name,
        u.username as submitted_by_name
      FROM fixed_deposit_requests fd
      LEFT JOIN counterparty_master_corporate corp ON fd.counterparty_id = corp.id
      LEFT JOIN counterparty_master_individual ind ON fd.counterparty_id = ind.id
      LEFT JOIN counterparty_master_joint joint ON fd.counterparty_id = joint.id
      LEFT JOIN portfolio_master p ON CAST(fd.portfolio_id AS CHAR) COLLATE utf8mb4_unicode_ci = CAST(p.portfolio_id AS CHAR) COLLATE utf8mb4_unicode_ci
      LEFT JOIN users u ON fd.submitted_by = u.id
      WHERE fd.current_approval_level = 'back_office_final' 
        AND LOWER(TRIM(fd.status)) IN ('pending', 'draft')
      ORDER BY fd.created_at DESC`
    );
    
    res.json(requests);
  } catch (error) {
    console.error('Error fetching pending fixed deposit requests:', error);
    res.status(500).json({ error: 'Failed to fetch pending requests', details: error.message });
  }
});

/**
 * Get a single Fixed Deposit request by ID
 * GET /api/fixed-deposit/requests/:id
 */
router.get('/requests/:id', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const [requests] = await db.query(
      `SELECT 
        fd.*,
        COALESCE(
          corp.short_name,
          ind.short_name,
          joint.short_name,
          CONCAT('ID:', fd.counterparty_id)
        ) as counterparty_name,
        COALESCE(
          corp.long_name,
          ind.long_name,
          joint.long_name,
          corp.company_name,
          NULL
        ) as counterparty_long_name,
        p.portfolio_name as portfolio_name,
        u.username as submitted_by_name
      FROM fixed_deposit_requests fd
      LEFT JOIN counterparty_master_corporate corp ON fd.counterparty_id = corp.id
      LEFT JOIN counterparty_master_individual ind ON fd.counterparty_id = ind.id
      LEFT JOIN counterparty_master_joint joint ON fd.counterparty_id = joint.id
      LEFT JOIN portfolio_master p ON fd.portfolio_id = p.portfolio_id
      LEFT JOIN users u ON fd.submitted_by = u.id
      WHERE fd.id = ?`,
      [id]
    );
    
    if (requests.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    res.json(requests[0]);
  } catch (error) {
    console.error('Error fetching fixed deposit request:', error);
    res.status(500).json({ error: 'Failed to fetch fixed deposit request' });
  }
});

/**
 * Create a new Fixed Deposit request
 * POST /api/fixed-deposit/requests
 */
router.post('/requests', checkAuth, async (req, res) => {
  try {
    const user = req.user || JSON.parse(req.headers['x-user'] || '{}');
    const userId = user.id || user.userId;
    
    const {
      portfolio,
      book,
      module,
      requestNo,
      fileNumber,
      status,
      counterpartyType,
      counterpartyName,
      contactPerson,
      requestRemarks,
      instrumentType,
      isin,
      currency,
      requestedAmount,
      targetYield,
      valueDate,
      maturityDate,
      approvalCategory,
      approverId,
      approverName,
      approverDesignation,
      approvalLimitRequired,
      approverNotes,
      fundMovement,
      fundMovementType,
      partAmountCash,
      partAmountFromSources,
      settlementAccountCode,
      fundSourceDealIds,
      dayBasis
    } = req.body;

    const dayBasisVal = dayBasis === 364 ? 364 : 365;
    let dailyAccrual = null;
    const principal = requestedAmount != null && requestedAmount !== '' ? parseFloat(requestedAmount) : null;
    const yieldPct = targetYield != null && targetYield !== '' ? parseFloat(targetYield) : null;
    if (principal != null && !isNaN(principal) && principal > 0 && yieldPct != null && !isNaN(yieldPct)) {
      dailyAccrual = (principal * yieldPct / 100) / dayBasisVal;
      dailyAccrual = Math.floor(dailyAccrual * 100000000) / 100000000;
    }
    
    // Find counterparty ID from issuer_id (from Issuer Master)
    let counterpartyId = null;
    if (counterpartyName) {
      // First try to find in issuer_master by issuer_id
      const [issuerRows] = await db.query(
        `SELECT id FROM issuer_master WHERE issuer_id = ? LIMIT 1`,
        [counterpartyName]
      );
      if (issuerRows.length > 0) {
        counterpartyId = issuerRows[0].id;
      } else {
        // Fallback to counterparty_master_corporate
        const [cpRows] = await db.query(
          `SELECT id FROM counterparty_master_corporate WHERE issuer_id = ? OR id = ? LIMIT 1`,
          [counterpartyName, counterpartyName]
        );
        if (cpRows.length > 0) {
          counterpartyId = cpRows[0].id;
        }
      }
    }
    
    // Use approverName if provided, otherwise fall back to approvalCategory
    const approvalCategoryValue = approverName || approvalCategory || null;
    
    // Parse approverId as integer if provided
    const approverIdParsed = approverId ? parseInt(approverId, 10) : null;
    
    // Fund movement part-amount validation
    if (fundMovement === 'yes' && fundMovementType === 'part_amount') {
      const requested = parseFloat(requestedAmount);
      const cash = parseFloat(partAmountCash) || 0;
      const fromSources = parseFloat(partAmountFromSources) || 0;
      const sum = cash + fromSources;
      const tolerance = 0.01;
      if (isNaN(requested) || requested <= 0 || Math.abs(sum - requested) > tolerance) {
        return res.status(400).json({
          error: 'Part amount invalid',
          details: 'part_amount_cash + part_amount_from_sources must equal requested_amount'
        });
      }
      const sourceIds = Array.isArray(fundSourceDealIds) ? fundSourceDealIds : (fundSourceDealIds ? String(fundSourceDealIds).split(',').map(s => s.trim()).filter(Boolean) : []);
      if (sourceIds.length === 0 || fromSources <= 0) {
        return res.status(400).json({
          error: 'Part amount invalid',
          details: 'Select at least one source deal and ensure part_amount_from_sources > 0'
        });
      }
    }

    const fundSourceDealIdsStr = Array.isArray(fundSourceDealIds) ? fundSourceDealIds.join(',') : (fundSourceDealIds ? String(fundSourceDealIds) : null);

    // Set status to 'pending' and current_approval_level to 'back_office_final' for authorization workflow
    const requestStatus = status || 'pending';
    const approvalLevel = 'back_office_final';
    
    const [result] = await db.query(
      `INSERT INTO fixed_deposit_requests (
        portfolio_id, book, module, request_no, file_number, status, current_approval_level,
        counterparty_type, counterparty_id, contact_person, request_remarks,
        instrument_type, isin, currency, requested_amount, target_yield,
        value_date, maturity_date,
        day_basis, daily_accrual,
        approver_id, approver_name, approver_designation, approval_category,
        approval_limit_required, approver_notes,
        fund_movement, fund_movement_type, part_amount_cash, part_amount_from_sources,
        settlement_account_code, fund_source_deal_ids,
        submitted_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        portfolio || null,
        book || null,
        module || 'Pre approval',
        requestNo,
        fileNumber || null,
        requestStatus,
        approvalLevel,
        counterpartyType || 'Bank',
        counterpartyId,
        contactPerson || null,
        requestRemarks || null,
        instrumentType || null,
        isin || null,
        currency || 'LKR',
        requestedAmount ? parseFloat(requestedAmount) : null,
        targetYield ? parseFloat(targetYield) : null,
        valueDate,
        maturityDate,
        dayBasisVal,
        dailyAccrual,
        approverIdParsed,
        approverName || null,
        approverDesignation || null,
        approvalCategoryValue,
        approvalLimitRequired || null,
        approverNotes || null,
        fundMovement || null,
        fundMovementType || null,
        partAmountCash != null && partAmountCash !== '' ? parseFloat(partAmountCash) : null,
        partAmountFromSources != null && partAmountFromSources !== '' ? parseFloat(partAmountFromSources) : null,
        settlementAccountCode || null,
        fundSourceDealIdsStr,
        userId
      ]
    );
    
    res.status(201).json({
      success: true,
      id: result.insertId,
      message: 'Fixed deposit request created successfully'
    });
  } catch (error) {
    console.error('Error creating fixed deposit request:', error);
    res.status(500).json({ error: 'Failed to create fixed deposit request', details: error.message });
  }
});

/**
 * Update a Fixed Deposit request
 * PUT /api/fixed-deposit/requests/:id
 */
router.put('/requests/:id', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      portfolio,
      book,
      fileNumber,
      status,
      counterpartyName,
      contactPerson,
      requestRemarks,
      instrumentType,
      isin,
      currency,
      requestedAmount,
      targetYield,
      valueDate,
      maturityDate,
      approvalCategory,
      approvalLimitRequired,
      approverNotes,
      fundMovement,
      fundMovementType,
      partAmountCash,
      partAmountFromSources,
      settlementAccountCode,
      fundSourceDealIds,
      dayBasis
    } = req.body;

    // For PUT we may need existing requested_amount/target_yield to recompute daily_accrual
    let existingRow = null;
    if (dayBasis !== undefined || requestedAmount !== undefined || targetYield !== undefined) {
      const [rows] = await db.query(
        'SELECT requested_amount, target_yield, day_basis FROM fixed_deposit_requests WHERE id = ?',
        [id]
      );
      existingRow = rows[0] || null;
    }
    
    // Find counterparty ID if counterparty name provided
    let counterpartyId = null;
    if (counterpartyName) {
      const [cpRows] = await db.query(
        `SELECT id FROM counterparty_master_corporate WHERE unique_id = ? OR short_name = ? LIMIT 1`,
        [counterpartyName, counterpartyName]
      );
      if (cpRows.length > 0) {
        counterpartyId = cpRows[0].id;
      }
    }
    
    // Part-amount validation when updating to part_amount
    if (fundMovement === 'yes' && fundMovementType === 'part_amount') {
      const requested = requestedAmount != null && requestedAmount !== '' ? parseFloat(requestedAmount) : null;
      const cash = partAmountCash != null && partAmountCash !== '' ? parseFloat(partAmountCash) : 0;
      const fromSources = partAmountFromSources != null && partAmountFromSources !== '' ? parseFloat(partAmountFromSources) : 0;
      if (requested != null && !isNaN(requested) && requested > 0) {
        const sum = cash + fromSources;
        const tolerance = 0.01;
        if (Math.abs(sum - requested) > tolerance) {
          return res.status(400).json({
            error: 'Part amount invalid',
            details: 'part_amount_cash + part_amount_from_sources must equal requested_amount'
          });
        }
        const sourceIds = Array.isArray(fundSourceDealIds) ? fundSourceDealIds : (fundSourceDealIds ? String(fundSourceDealIds).split(',').map(s => s.trim()).filter(Boolean) : []);
        if (sourceIds.length === 0 || fromSources <= 0) {
          return res.status(400).json({
            error: 'Part amount invalid',
            details: 'Select at least one source deal and ensure part_amount_from_sources > 0'
          });
        }
      }
    }
    
    const updateFields = [];
    const updateValues = [];
    
    if (portfolio !== undefined) { updateFields.push('portfolio_id = ?'); updateValues.push(portfolio); }
    if (book !== undefined) { updateFields.push('book = ?'); updateValues.push(book); }
    if (fileNumber !== undefined) { updateFields.push('file_number = ?'); updateValues.push(fileNumber); }
    if (status !== undefined) { updateFields.push('status = ?'); updateValues.push(status); }
    if (counterpartyId !== null) { updateFields.push('counterparty_id = ?'); updateValues.push(counterpartyId); }
    if (contactPerson !== undefined) { updateFields.push('contact_person = ?'); updateValues.push(contactPerson); }
    if (requestRemarks !== undefined) { updateFields.push('request_remarks = ?'); updateValues.push(requestRemarks); }
    if (instrumentType !== undefined) { updateFields.push('instrument_type = ?'); updateValues.push(instrumentType); }
    if (isin !== undefined) { updateFields.push('isin = ?'); updateValues.push(isin); }
    if (currency !== undefined) { updateFields.push('currency = ?'); updateValues.push(currency); }
    if (requestedAmount !== undefined) { updateFields.push('requested_amount = ?'); updateValues.push(parseFloat(requestedAmount)); }
    if (targetYield !== undefined) { updateFields.push('target_yield = ?'); updateValues.push(parseFloat(targetYield)); }
    if (valueDate !== undefined) { updateFields.push('value_date = ?'); updateValues.push(valueDate); }
    if (maturityDate !== undefined) { updateFields.push('maturity_date = ?'); updateValues.push(maturityDate); }
    if (approvalCategory !== undefined) { updateFields.push('approval_category = ?'); updateValues.push(approvalCategory); }
    if (approvalLimitRequired !== undefined) { updateFields.push('approval_limit_required = ?'); updateValues.push(approvalLimitRequired); }
    if (approverNotes !== undefined) { updateFields.push('approver_notes = ?'); updateValues.push(approverNotes); }
    if (fundMovement !== undefined) { updateFields.push('fund_movement = ?'); updateValues.push(fundMovement); }
    if (fundMovementType !== undefined) { updateFields.push('fund_movement_type = ?'); updateValues.push(fundMovementType); }
    if (partAmountCash !== undefined) { updateFields.push('part_amount_cash = ?'); updateValues.push(partAmountCash != null && partAmountCash !== '' ? parseFloat(partAmountCash) : null); }
    if (partAmountFromSources !== undefined) { updateFields.push('part_amount_from_sources = ?'); updateValues.push(partAmountFromSources != null && partAmountFromSources !== '' ? parseFloat(partAmountFromSources) : null); }
    if (settlementAccountCode !== undefined) { updateFields.push('settlement_account_code = ?'); updateValues.push(settlementAccountCode); }
    if (fundSourceDealIds !== undefined) {
      const fundSourceDealIdsStr = Array.isArray(fundSourceDealIds) ? fundSourceDealIds.join(',') : (fundSourceDealIds ? String(fundSourceDealIds) : null);
      updateFields.push('fund_source_deal_ids = ?');
      updateValues.push(fundSourceDealIdsStr);
    }
    if (dayBasis !== undefined) {
      const dayBasisVal = dayBasis === 364 ? 364 : 365;
      updateFields.push('day_basis = ?');
      updateValues.push(dayBasisVal);
    }
    if (existingRow) {
      const principal = requestedAmount !== undefined
        ? (requestedAmount != null && requestedAmount !== '' ? parseFloat(requestedAmount) : null)
        : (existingRow.requested_amount != null ? parseFloat(existingRow.requested_amount) : null);
      const yieldPct = targetYield !== undefined
        ? (targetYield != null && targetYield !== '' ? parseFloat(targetYield) : null)
        : (existingRow.target_yield != null ? parseFloat(existingRow.target_yield) : null);
      const basis = dayBasis !== undefined ? (dayBasis === 364 ? 364 : 365) : (existingRow.day_basis === 364 ? 364 : 365);
      let dailyAccrual = null;
      if (principal != null && !isNaN(principal) && principal > 0 && yieldPct != null && !isNaN(yieldPct)) {
        dailyAccrual = (principal * yieldPct / 100) / basis;
        dailyAccrual = Math.floor(dailyAccrual * 100000000) / 100000000;
      }
      updateFields.push('daily_accrual = ?');
      updateValues.push(dailyAccrual);
    }
    
    updateFields.push('updated_at = NOW()');
    updateValues.push(id);
    
    if (updateFields.length === 1) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    await db.query(
      `UPDATE fixed_deposit_requests SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );
    
    res.json({ success: true, message: 'Fixed deposit request updated successfully' });
  } catch (error) {
    console.error('Error updating fixed deposit request:', error);
    res.status(500).json({ error: 'Failed to update fixed deposit request', details: error.message });
  }
});

/**
 * Approve a Fixed Deposit request
 * PUT /api/fixed-deposit/requests/:id/approve
 */
router.put('/requests/:id/approve', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { approverNotes } = req.body;

    const actor = await requireFdApprover(req, res, id);
    if (!actor) return;

    // Update the request status
    await db.query(
      `UPDATE fixed_deposit_requests
       SET status = 'Approved',
           current_approval_level = 'final_approved',
           approver_notes = ?,
           approved_by = ?,
           approved_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [approverNotes || null, actor.id, id]
    );
    
    // Create ledger entries after final approval
    try {
      console.log(`[Fixed Deposit] Starting ledger entry creation for request ID: ${id}`);
      
      // Fetch the fixed deposit request details
      const [fdRows] = await db.query('SELECT * FROM fixed_deposit_requests WHERE id = ?', [id]);
      const fdRequest = fdRows[0];
      
      if (!fdRequest) {
        console.error(`[Fixed Deposit] Request not found for ledger entry creation: ${id}`);
        return res.json({ success: true, message: 'Request approved successfully' });
      }
      
      console.log(`[Fixed Deposit] Request found: ${fdRequest.request_no}, Amount: ${fdRequest.requested_amount}, Status: ${fdRequest.status}`);
      
      // Check if ledger entries already exist for this request
      const requestNumber = fdRequest.request_no || `FD-${id}`;
      const [existingEntries] = await db.query(
        'SELECT COUNT(*) as cnt FROM ledger_entries WHERE deal_number = ?',
        [requestNumber]
      );
      
      if (existingEntries[0].cnt > 0) {
        console.log(`[Fixed Deposit] Ledger entries already exist for request ${requestNumber}, skipping creation`);
        return res.json({ success: true, message: 'Request approved successfully' });
      }
      
      const amount = parseFloat(fdRequest.requested_amount || 0);
      if (amount <= 0) {
        console.error(`[Fixed Deposit] Invalid amount for ledger entry: ${amount} (Request ID: ${id})`);
        return res.json({ success: true, message: 'Request approved successfully' });
      }
      
      console.log(`[Fixed Deposit] Amount validated: ${amount}`);
      
      // Get Fixed Deposit Investment Account
      // Try to get from account mapping first, fallback to pattern search, then direct lookup
      let fdInvestmentAccount = null;
      try {
        const accountMapping = require('../services/accountMappingService');
        const fdAccountCode = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.FD_INVESTMENT);
        console.log(`[Fixed Deposit] Using mapped account code: ${fdAccountCode}`);
        const [fdAccounts] = await db.query('SELECT * FROM chart_of_accounts WHERE account_code = ?', [fdAccountCode]);
        fdInvestmentAccount = fdAccounts[0];
      } catch (mappingError) {
        console.log(`[Fixed Deposit] Account mapping not found (${mappingError.message}), trying pattern search...`);
        // Try to find any investment account
        const [investmentAccounts] = await db.query(
          `SELECT * FROM chart_of_accounts 
           WHERE (name LIKE '%investment%' OR name LIKE '%deposit%' OR name LIKE '%fixed%' OR account_code LIKE '2%')
           AND is_active = TRUE 
           LIMIT 1`
        );
        if (investmentAccounts.length > 0) {
          fdInvestmentAccount = investmentAccounts[0];
          console.log(`[Fixed Deposit] Found investment account via pattern: ${fdInvestmentAccount.account_code} - ${fdInvestmentAccount.name}`);
        } else {
          // Fallback to default account code 2002
          console.log(`[Fixed Deposit] Trying default account code 2002...`);
          const [fdAccounts] = await db.query('SELECT * FROM chart_of_accounts WHERE account_code = ?', ['2002']);
          fdInvestmentAccount = fdAccounts[0];
        }
      }
      
      if (!fdInvestmentAccount) {
        console.error(`[Fixed Deposit] Fixed Deposit Investment Account not found in chart_of_accounts`);
        console.error(`[Fixed Deposit] Please create an investment account in chart_of_accounts (e.g., code: 2002, name: "Fixed Income Investments")`);
        return res.json({ success: true, message: 'Request approved successfully' });
      }
      
      console.log(`[Fixed Deposit] Investment Account found: ID=${fdInvestmentAccount.id}, Code=${fdInvestmentAccount.account_code}, Name=${fdInvestmentAccount.name}`);
      
      // Get Bank Settlement Account
      // Try multiple fallback methods to find a bank account
      let bankAccount = null;
      
      // First, try to get default settlement account from mapping
      try {
        const accountMapping = require('../services/accountMappingService');
        const defaultSettlementCode = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.FD_DEFAULT_SETTLEMENT);
        console.log(`[Fixed Deposit] Using mapped settlement account code: ${defaultSettlementCode}`);
        const [bankAccounts] = await db.query('SELECT * FROM chart_of_accounts WHERE account_code = ?', [defaultSettlementCode]);
        bankAccount = bankAccounts[0];
      } catch (mappingError) {
        console.log(`[Fixed Deposit] Settlement mapping not found (${mappingError.message}), trying fallback methods...`);
        
        // Try to find any bank/cash account via pattern search
        const [bankAccounts] = await db.query(
          `SELECT * FROM chart_of_accounts 
           WHERE (name LIKE '%bank%' OR name LIKE '%cash%' OR account_code LIKE '1%')
           AND is_active = TRUE 
           LIMIT 1`
        );
        if (bankAccounts.length > 0) {
          bankAccount = bankAccounts[0];
          console.log(`[Fixed Deposit] Found bank account via pattern: ${bankAccount.account_code} - ${bankAccount.name}`);
        } else {
          // Try default account code 1002
          console.log(`[Fixed Deposit] Trying default account code 1002...`);
          const [defaultBankRows] = await db.query('SELECT * FROM chart_of_accounts WHERE account_code = ?', ['1002']);
          bankAccount = defaultBankRows[0];
        }
      }
      
      if (!bankAccount) {
        console.error(`[Fixed Deposit] Bank Settlement Account not found for fixed deposit ledger entry`);
        console.error(`[Fixed Deposit] Please create a bank account in chart_of_accounts (e.g., code: 1002, name: "Bank Current Account")`);
        return res.json({ success: true, message: 'Request approved successfully' });
      }
      
      console.log(`[Fixed Deposit] Bank Account found: ID=${bankAccount.id}, Code=${bankAccount.account_code}, Name=${bankAccount.name}`);
      
      // Create ledger entries: DR Fixed Deposit Investment, CR Bank Account
      const entryDate = fdRequest.value_date || new Date().toISOString().split('T')[0];
      const description = `Fixed Deposit - ${fdRequest.request_no || requestNumber}`;
      
      console.log(`[Fixed Deposit] Creating ledger entries: Date=${entryDate}, Amount=${amount}, Deal Number=${requestNumber}`);
      
      // DR: Fixed Deposit Investment Account
      const [drResult] = await db.query(
        `INSERT INTO ledger_entries 
         (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description) 
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
        [requestNumber, fdInvestmentAccount.id, entryDate, amount, fdRequest.currency || 'LKR', `${description} - DR Investment`]
      );
      
      console.log(`[Fixed Deposit] DR Entry created: ID=${drResult.insertId}`);
      
      // CR: Bank Settlement Account
      const [crResult] = await db.query(
        `INSERT INTO ledger_entries 
         (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description) 
         VALUES (?, ?, ?, 0, ?, ?, ?)`,
        [requestNumber, bankAccount.id, entryDate, amount, fdRequest.currency || 'LKR', `${description} - CR Bank Account`]
      );
      
      console.log(`[Fixed Deposit] CR Entry created: ID=${crResult.insertId}`);
      console.log(`[Fixed Deposit] Successfully created ledger entries for fixed deposit request ${requestNumber}`);
    } catch (ledgerError) {
      // Log the error but don't fail the approval
      console.error(`[Fixed Deposit] Error creating ledger entries for fixed deposit (ID: ${id}):`, ledgerError);
      console.error(`[Fixed Deposit] Error stack:`, ledgerError.stack);
      // Continue with the response even if ledger entry fails
    }
    
    res.json({ success: true, message: 'Request approved successfully' });
  } catch (error) {
    console.error('Error approving request:', error);
    res.status(500).json({ error: 'Failed to approve request', details: error.message });
  }
});

/**
 * Reject a Fixed Deposit request
 * PUT /api/fixed-deposit/requests/:id/reject
 */
router.put('/requests/:id/reject', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { approverNotes } = req.body;

    if (!approverNotes || !approverNotes.trim()) {
      return res.status(400).json({ error: 'Rejection comment is required' });
    }

    const actor = await requireFdApprover(req, res, id);
    if (!actor) return;

    await db.query(
      `UPDATE fixed_deposit_requests
       SET status = 'Returned',
           current_approval_level = 'back_office_final',
           approver_notes = ?,
           rejected_by = ?,
           rejected_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [approverNotes, actor.id, id]
    );
    
    res.json({ success: true, message: 'Request rejected successfully' });
  } catch (error) {
    console.error('Error rejecting request:', error);
    res.status(500).json({ error: 'Failed to reject request', details: error.message });
  }
});

/**
 * Get Fixed Deposit requests by file number
 * GET /api/fixed-deposit/requests/file-number/:fileNumber
 */
router.get('/requests/file-number/:fileNumber', checkAuth, async (req, res) => {
  try {
    const { fileNumber } = req.params;
    
    const [requests] = await db.query(
      `SELECT 
        fd.*,
        COALESCE(
          corp.short_name,
          ind.short_name,
          joint.short_name,
          CONCAT('ID:', fd.counterparty_id)
        ) as counterparty_name,
        COALESCE(
          corp.long_name,
          ind.long_name,
          joint.long_name,
          corp.company_name,
          NULL
        ) as counterparty_long_name,
        p.portfolio_name as portfolio_name,
        u.username as submitted_by_name
      FROM fixed_deposit_requests fd
      LEFT JOIN counterparty_master_corporate corp ON fd.counterparty_id = corp.id
      LEFT JOIN counterparty_master_individual ind ON fd.counterparty_id = ind.id
      LEFT JOIN counterparty_master_joint joint ON fd.counterparty_id = joint.id
      LEFT JOIN portfolio_master p ON CAST(fd.portfolio_id AS CHAR) COLLATE utf8mb4_unicode_ci = CAST(p.portfolio_id AS CHAR) COLLATE utf8mb4_unicode_ci
      LEFT JOIN users u ON fd.submitted_by = u.id
      WHERE fd.file_number = ?
      ORDER BY fd.created_at DESC`,
      [fileNumber]
    );
    
    res.json(requests);
  } catch (error) {
    console.error('Error fetching fixed deposit requests by file number:', error);
    res.status(500).json({ error: 'Failed to fetch fixed deposit requests by file number', details: error.message });
  }
});

/**
 * Search Fixed Deposit requests by file number (partial match)
 * GET /api/fixed-deposit/requests/search/file-number?q=searchTerm
 */
router.get('/requests/search/file-number', checkAuth, async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query parameter "q" is required' });
    }
    
    const [requests] = await db.query(
      `SELECT 
        fd.*,
        COALESCE(
          corp.short_name,
          ind.short_name,
          joint.short_name,
          CONCAT('ID:', fd.counterparty_id)
        ) as counterparty_name,
        COALESCE(
          corp.long_name,
          ind.long_name,
          joint.long_name,
          corp.company_name,
          NULL
        ) as counterparty_long_name,
        p.portfolio_name as portfolio_name,
        u.username as submitted_by_name
      FROM fixed_deposit_requests fd
      LEFT JOIN counterparty_master_corporate corp ON fd.counterparty_id = corp.id
      LEFT JOIN counterparty_master_individual ind ON fd.counterparty_id = ind.id
      LEFT JOIN counterparty_master_joint joint ON fd.counterparty_id = joint.id
      LEFT JOIN portfolio_master p ON CAST(fd.portfolio_id AS CHAR) COLLATE utf8mb4_unicode_ci = CAST(p.portfolio_id AS CHAR) COLLATE utf8mb4_unicode_ci
      LEFT JOIN users u ON fd.submitted_by = u.id
      WHERE fd.file_number LIKE ?
      ORDER BY fd.created_at DESC`,
      [`%${q}%`]
    );
    
    res.json(requests);
  } catch (error) {
    console.error('Error searching fixed deposit requests by file number:', error);
    res.status(500).json({ error: 'Failed to search fixed deposit requests by file number', details: error.message });
  }
});

module.exports = router;
