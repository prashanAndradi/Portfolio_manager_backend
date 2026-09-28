const db = require('../config/db');

let buybackDealsColumnSetPromise = null;
let buybackApprovalColumnsEnsurePromise = null;

// Self-healing schema, mirroring the pattern used for gsec/repo_deals: adds the
// per-tier approver columns if this DB predates them, instead of requiring a
// separate manual migration to be run first.
const ensureBuybackApprovalColumns = async () => {
  if (!buybackApprovalColumnsEnsurePromise) {
    buybackApprovalColumnsEnsurePromise = (async () => {
      const requiredColumns = {
        front_office_by: 'INT NULL',
        back_office_verifier_by: 'INT NULL',
        final_approved_by: 'INT NULL'
      };
      const columnNames = Object.keys(requiredColumns);
      const placeholders = columnNames.map(() => '?').join(', ');
      const [rows] = await db.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'buyback_deals'
           AND COLUMN_NAME IN (${placeholders})`,
        columnNames
      );
      const present = new Set((rows || []).map((r) => r.COLUMN_NAME));
      for (const columnName of columnNames) {
        if (present.has(columnName)) continue;
        await db.query(`ALTER TABLE buyback_deals ADD COLUMN ${columnName} ${requiredColumns[columnName]}`);
      }
    })().catch((err) => {
      buybackApprovalColumnsEnsurePromise = null;
      throw err;
    });
  }
  return buybackApprovalColumnsEnsurePromise;
};

const getBuybackDealsColumnSet = async (forceRefresh = false) => {
  if (forceRefresh) {
    buybackDealsColumnSetPromise = null;
  }
  if (!buybackDealsColumnSetPromise) {
    buybackDealsColumnSetPromise = db
      .query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'buyback_deals'`
      )
      .then(([rows]) => new Set((rows || []).map((r) => r.COLUMN_NAME)));
  }
  return buybackDealsColumnSetPromise;
};

const buildBuybackDealSelectSql = async (whereClause = '', whereParams = []) => {
  const cols = await getBuybackDealsColumnSet();
  const hasVerifiedBy = cols.has('verified_by');
  const hasApprovedBy = cols.has('approved_by');

  let hasGsecBuybackDealId = false;
  try {
    const [gsecCols] = await db.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'gsec'
         AND COLUMN_NAME = 'buyback_deal_id'
       LIMIT 1`
    );
    hasGsecBuybackDealId = Array.isArray(gsecCols) && gsecCols.length > 0;
  } catch (_) {
    /* leave false */
  }

  const selectParts = [
    'bd.*',
    'creator.username as created_by_name',
    hasVerifiedBy ? 'verifier.username as verified_by_name' : 'NULL as verified_by_name',
    hasApprovedBy ? 'approver.username as approved_by_name' : 'NULL as approved_by_name',
    // Resolved counterparty display names for both legs - blotters show Seller/Buyer
    // from the Sell/Buy legs rather than a single (often Sherwood) Counterparty.
    `COALESCE(corp1.short_name, ind1.short_name, joint1.short_name, bd.leg1_counterparty, '') AS leg1_counterparty_name`,
    `COALESCE(corp2.short_name, ind2.short_name, joint2.short_name, bd.leg2_counterparty, '') AS leg2_counterparty_name`,
    // Letter GSEC ids for Buy/Sell blotter Leg 1 / Leg 2 Letter buttons
    hasGsecBuybackDealId
      ? `(SELECT g.id FROM gsec g
          WHERE g.buyback_deal_id = bd.id
            AND g.transaction_type = 'Buy'
            AND COALESCE(g.status, '') NOT IN ('cancelled', 'rejected')
          ORDER BY g.id ASC LIMIT 1) AS leg1_letter_gsec_id`
      : 'NULL AS leg1_letter_gsec_id',
    hasGsecBuybackDealId
      ? `(SELECT g.id FROM gsec g
          WHERE g.buyback_deal_id = bd.id
            AND g.transaction_type = 'Sell'
            AND COALESCE(g.status, '') NOT IN ('cancelled', 'rejected')
          ORDER BY g.id ASC LIMIT 1) AS leg2_letter_gsec_id`
      : 'NULL AS leg2_letter_gsec_id'
  ];

  const joinParts = [
    'LEFT JOIN users creator ON bd.created_by = creator.id',
    hasVerifiedBy ? 'LEFT JOIN users verifier ON bd.verified_by = verifier.id' : null,
    hasApprovedBy ? 'LEFT JOIN users approver ON bd.approved_by = approver.id' : null,
    `LEFT JOIN counterparty_master_corporate corp1
       ON (bd.leg1_counterparty LIKE 'c%' AND CAST(SUBSTRING(bd.leg1_counterparty, 2) AS UNSIGNED) = corp1.id)
       OR (bd.leg1_counterparty = corp1.id)`,
    `LEFT JOIN counterparty_master_individual ind1
       ON (bd.leg1_counterparty LIKE 'i%' AND CAST(SUBSTRING(bd.leg1_counterparty, 2) AS UNSIGNED) = ind1.id)
       OR (bd.leg1_counterparty = ind1.id)`,
    `LEFT JOIN counterparty_master_joint joint1
       ON (bd.leg1_counterparty LIKE 'j%' AND CAST(SUBSTRING(bd.leg1_counterparty, 2) AS UNSIGNED) = joint1.id)
       OR (bd.leg1_counterparty = joint1.id)`,
    `LEFT JOIN counterparty_master_corporate corp2
       ON (bd.leg2_counterparty LIKE 'c%' AND CAST(SUBSTRING(bd.leg2_counterparty, 2) AS UNSIGNED) = corp2.id)
       OR (bd.leg2_counterparty = corp2.id)`,
    `LEFT JOIN counterparty_master_individual ind2
       ON (bd.leg2_counterparty LIKE 'i%' AND CAST(SUBSTRING(bd.leg2_counterparty, 2) AS UNSIGNED) = ind2.id)
       OR (bd.leg2_counterparty = ind2.id)`,
    `LEFT JOIN counterparty_master_joint joint2
       ON (bd.leg2_counterparty LIKE 'j%' AND CAST(SUBSTRING(bd.leg2_counterparty, 2) AS UNSIGNED) = joint2.id)
       OR (bd.leg2_counterparty = joint2.id)`
  ].filter(Boolean);

  const sql = `SELECT
      ${selectParts.join(',\n      ')}
    FROM buyback_deals bd
    ${joinParts.join('\n    ')}
    ${whereClause}
    ORDER BY bd.created_at DESC`;

  return { sql, params: whereParams };
};

const BuybackDeal = {
  // Create a new buyback deal
  create: async (dealData) => {
    // Some environments might have older buyback schemas.
    // Ensure required INSERT columns exist (idempotent) so create won't crash.
    // Force refresh because schema may have changed after process boot.
    const cols = await getBuybackDealsColumnSet(true);
    const ensureColumnExists = async (column, definition) => {
      if (cols.has(column)) return;
      // Add as NULL-safe columns to avoid breaking existing rows.
      try {
        await db.query(`ALTER TABLE buyback_deals ADD COLUMN ${column} ${definition}`);
      } catch (err) {
        // Concurrent requests can race on ALTER TABLE; treat duplicate field as success.
        if (err && err.code === 'ER_DUP_FIELDNAME') {
          cols.add(column);
          return;
        }
        throw err;
      }
      cols.add(column);
    };

    const requiredColumnDefinitions = {
      // Deal
      deal_number: 'VARCHAR(50) NULL',

      // Leg 1
      leg1_trade_date: 'DATE NULL',
      leg1_value_date: 'DATE NULL',
      leg1_transaction_type: "ENUM('Buy', 'Sell') NULL",
      leg1_trade_type: "VARCHAR(20) DEFAULT 'BuyBack'",
      leg1_isin: 'VARCHAR(20) NULL',
      leg1_counterparty: 'VARCHAR(50) NULL',
      leg1_broker: 'INT NULL',
      leg1_portfolio: 'VARCHAR(50) NULL',
      leg1_strategy: 'VARCHAR(50) NULL',
      leg1_custodian: 'VARCHAR(100) NULL',
      leg1_settlement_mode: "ENUM('RTGS', 'CEFT', 'SLIPS', 'Cheque', 'Other') NULL DEFAULT 'RTGS'",
      leg1_brokerage: 'DECIMAL(8,4) NULL DEFAULT 0.0000',
      leg1_interest_rate: 'DECIMAL(8,4) NULL DEFAULT 0.0000',
      leg1_face_value: 'DECIMAL(18,2) NULL',
      leg1_adjusted_face_value: 'DECIMAL(18,2) NULL',
      leg1_yield_rate: 'DECIMAL(10,6) NULL',
      leg1_settlement_amount: 'DECIMAL(18,2) NULL',
      leg1_clean_price: 'DECIMAL(10,4) NULL',
      leg1_dirty_price: 'DECIMAL(10,4) NULL',
      leg1_accrued_interest: 'DECIMAL(10,4) NULL',
      leg1_currency: "VARCHAR(3) NULL DEFAULT 'LKR'",

      // Leg 2
      leg2_trade_date: 'DATE NULL',
      leg2_value_date: 'DATE NULL',
      leg2_transaction_type: "ENUM('Buy', 'Sell') NULL",
      leg2_trade_type: "VARCHAR(20) DEFAULT 'BuyBack'",
      leg2_isin: 'VARCHAR(20) NULL',
      leg2_counterparty: 'VARCHAR(50) NULL',
      leg2_portfolio: 'VARCHAR(50) NULL',
      leg2_strategy: 'VARCHAR(50) NULL',
      leg2_custodian: 'VARCHAR(100) NULL',
      leg2_settlement_mode: "ENUM('RTGS', 'CEFT', 'SLIPS', 'Cheque', 'Other') NULL DEFAULT 'RTGS'",
      leg2_face_value: 'DECIMAL(18,2) NULL',
      leg2_adjusted_face_value: 'DECIMAL(18,2) NULL',
      leg2_yield_rate: 'DECIMAL(10,6) NULL',
      leg2_settlement_amount: 'DECIMAL(18,2) NULL',
      leg2_clean_price: 'DECIMAL(10,4) NULL',
      leg2_dirty_price: 'DECIMAL(10,4) NULL',
      leg2_accrued_interest: 'DECIMAL(10,4) NULL',
      leg2_currency: "VARCHAR(3) NULL DEFAULT 'LKR'",

      // ISIN metadata
      issue_date: 'DATE NULL',
      maturity_date: 'DATE NULL',
      coupon_rate: 'DECIMAL(8,4) NULL',
      coupon_date1: 'VARCHAR(5) NULL',
      coupon_date2: 'VARCHAR(5) NULL',

      // Status and tracking
      deal_status:
        "ENUM('Draft', 'Pending_Verification', 'Verified', 'Pending_Final_Approval', 'Approved', 'Rejected', 'Settled') NULL DEFAULT 'Draft'",
      fund_movement: "VARCHAR(10) NULL DEFAULT 'no'",
      created_by: 'INT NULL',
      notes: 'TEXT NULL',
      // Stores JSON array [{deal_number, amountToSell}] for every buy deal selected at creation time
      sell_deal_allocations: 'JSON NULL'
    };

    for (const [column, definition] of Object.entries(requiredColumnDefinitions)) {
      await ensureColumnExists(column, definition);
    }

    const insertColumnsSql = `INSERT INTO buyback_deals (
      deal_number,
      leg1_trade_date, leg1_value_date, leg1_transaction_type, leg1_trade_type, leg1_isin,
      leg1_counterparty, leg1_broker, leg1_portfolio, leg1_strategy, leg1_custodian,
      leg1_settlement_mode, leg1_brokerage, leg1_interest_rate, leg1_face_value, leg1_adjusted_face_value,
      leg1_yield_rate, leg1_settlement_amount, leg1_clean_price, leg1_dirty_price,
      leg1_accrued_interest, leg1_currency,
      leg2_trade_date, leg2_value_date, leg2_transaction_type, leg2_trade_type, leg2_isin,
      leg2_counterparty, leg2_portfolio, leg2_strategy, leg2_custodian, leg2_settlement_mode,
      leg2_face_value, leg2_adjusted_face_value, leg2_yield_rate, leg2_settlement_amount, leg2_clean_price,
      leg2_dirty_price, leg2_accrued_interest, leg2_currency,
      issue_date, maturity_date, coupon_rate, coupon_date1, coupon_date2,
      deal_status, fund_movement, created_by, notes, source_buy_deal_number, sell_deal_allocations
    )`;

    const values = [
      dealData.deal_number,
      // Leg 1
      dealData.leg1.tradeDate, dealData.leg1.valueDate, dealData.leg1.transactionType,
      dealData.leg1.tradeType, dealData.leg1.isin, dealData.leg1.counterparty,
      dealData.leg1.broker, dealData.leg1.portfolio, dealData.leg1.strategy,
      dealData.leg1.custodian, dealData.leg1.settlementMode, dealData.leg1.brokerage,
      dealData.leg1.interestRate, dealData.leg1.faceValue, dealData.leg1.adjustedFaceValue, dealData.leg1.yield,
      dealData.leg1.settlementAmount, dealData.leg1.cleanPrice, dealData.leg1.dirtyPrice,
      dealData.leg1.accruedInterest, dealData.leg1.currency,
      // Leg 2
      dealData.leg2.tradeDate, dealData.leg2.valueDate, dealData.leg2.transactionType,
      dealData.leg2.tradeType, dealData.leg2.isin, dealData.leg2.counterparty,
      dealData.leg2.portfolio, dealData.leg2.strategy, dealData.leg2.custodian,
      dealData.leg2.settlementMode, dealData.leg2.faceValue, dealData.leg2.adjustedFaceValue, dealData.leg2.yield,
      dealData.leg2.settlementAmount, dealData.leg2.cleanPrice, dealData.leg2.dirtyPrice,
      dealData.leg2.accruedInterest, dealData.leg2.currency,
      // ISIN metadata
      dealData.issueDate, dealData.maturityDate, dealData.couponRate,
      dealData.couponDate1, dealData.couponDate2,
      // Status and tracking
      dealData.deal_status || 'Pending_Verification',
      String(dealData.fund_movement || 'no').toLowerCase() === 'yes' ? 'yes' : 'no',
      dealData.created_by,
      dealData.notes || null,
      dealData.source_buy_deal_number || null,
      dealData.sell_deal_allocations != null
        ? JSON.stringify(dealData.sell_deal_allocations)
        : null
    ];

    const placeholders = new Array(values.length).fill('?').join(', ');
    const sql = `${insertColumnsSql} VALUES (${placeholders})`;
    const [result] = await db.query(sql, values);
    return result;
  },

  // Get all buyback deals
  getAll: async () => {
    const { sql, params } = await buildBuybackDealSelectSql();
    const [rows] = await db.query(sql, params);
    return rows;
  },

  // Get a single buyback deal by ID
  getById: async (id) => {
    const { sql, params } = await buildBuybackDealSelectSql('WHERE bd.id = ?', [id]);
    const [rows] = await db.query(sql, params);
    return rows[0];
  },

  // Get buyback deals by status
  getByStatus: async (status) => {
    const { sql, params } = await buildBuybackDealSelectSql('WHERE bd.deal_status = ?', [status]);
    const [rows] = await db.query(sql, params);
    return rows;
  },

  // Update deal status. Pass `conn` to run inside a caller's transaction so the
  // status and the approval side effects commit or roll back together.
  updateStatus: async (id, status, userId, field = 'verified_by', timestampField = 'verified_at', tierField = null, conn = null) => {
    if (tierField) {
      try {
        await ensureBuybackApprovalColumns();
      } catch (ensureErr) {
        console.warn('ensureBuybackApprovalColumns failed; will skip tier approver column write:', ensureErr?.message || ensureErr);
      }
    }
    // Refresh schema to avoid stale column cache skipping approval timestamps.
    const cols = await getBuybackDealsColumnSet(true);

    const setters = ['deal_status = ?'];
    const params = [status];

    if (field && cols.has(field)) {
      setters.push(`${field} = ?`);
      params.push(userId);
    }

    if (timestampField && cols.has(timestampField)) {
      setters.push(`${timestampField} = NOW()`);
    }

    if (tierField && cols.has(tierField) && userId != null) {
      setters.push(`${tierField} = ?`);
      params.push(userId);
    }

    const sql = `UPDATE buyback_deals
                 SET ${setters.join(', ')}
                 WHERE id = ?`;
    params.push(id);

    const [result] = await (conn || db).query(sql, params);
    return result;
  },

  // Update deal
  update: async (id, dealData) => {
    const sql = `UPDATE buyback_deals SET
      leg1_trade_date = ?, leg1_value_date = ?, leg1_transaction_type = ?, leg1_isin = ?,
      leg1_counterparty = ?, leg1_broker = ?, leg1_portfolio = ?, leg1_strategy = ?,
      leg1_custodian = ?, leg1_settlement_mode = ?, leg1_brokerage = ?, leg1_interest_rate = ?,
      leg1_face_value = ?, leg1_adjusted_face_value = ?, leg1_yield_rate = ?, leg1_settlement_amount = ?, leg1_clean_price = ?,
      leg1_dirty_price = ?, leg1_accrued_interest = ?,
      leg2_trade_date = ?, leg2_value_date = ?, leg2_transaction_type = ?, leg2_isin = ?,
      leg2_counterparty = ?, leg2_portfolio = ?, leg2_strategy = ?, leg2_custodian = ?,
      leg2_settlement_mode = ?, leg2_face_value = ?, leg2_adjusted_face_value = ?, leg2_yield_rate = ?, leg2_settlement_amount = ?,
      leg2_clean_price = ?, leg2_dirty_price = ?, leg2_accrued_interest = ?,
      notes = ?, fund_movement = ?, deal_status = ?,
      source_buy_deal_number = ?, sell_deal_allocations = ?,
      approved_at = CASE
        WHEN ? = 'Approved' AND approved_at IS NULL THEN NOW()
        ELSE approved_at
      END,
      updated_at = NOW()
      WHERE id = ?`;

    const values = [
      // Leg 1
      dealData.leg1.tradeDate, dealData.leg1.valueDate, dealData.leg1.transactionType,
      dealData.leg1.isin, dealData.leg1.counterparty, dealData.leg1.broker,
      dealData.leg1.portfolio, dealData.leg1.strategy, dealData.leg1.custodian,
      dealData.leg1.settlementMode, dealData.leg1.brokerage, dealData.leg1.interestRate,
      dealData.leg1.faceValue, dealData.leg1.adjustedFaceValue, dealData.leg1.yield, dealData.leg1.settlementAmount,
      dealData.leg1.cleanPrice, dealData.leg1.dirtyPrice, dealData.leg1.accruedInterest,
      // Leg 2
      dealData.leg2.tradeDate, dealData.leg2.valueDate, dealData.leg2.transactionType,
      dealData.leg2.isin, dealData.leg2.counterparty, dealData.leg2.portfolio,
      dealData.leg2.strategy, dealData.leg2.custodian, dealData.leg2.settlementMode,
      dealData.leg2.faceValue, dealData.leg2.adjustedFaceValue, dealData.leg2.yield, dealData.leg2.settlementAmount,
      dealData.leg2.cleanPrice, dealData.leg2.dirtyPrice, dealData.leg2.accruedInterest,
      // Other
      dealData.notes,
      String(dealData.fund_movement || 'no').toLowerCase() === 'yes' ? 'yes' : 'no',
      dealData.deal_status || 'Pending_Verification',
      dealData.source_buy_deal_number || null,
      dealData.sell_deal_allocations != null
        ? JSON.stringify(dealData.sell_deal_allocations)
        : null,
      dealData.deal_status || 'Pending_Verification',
      id
    ];

    const [result] = await db.query(sql, values);
    return result;
  },

  // Delete deal
  delete: async (id) => {
    const sql = 'DELETE FROM buyback_deals WHERE id = ?';
    const [result] = await db.query(sql, [id]);
    return result;
  },

  // Generate deal number
  generateDealNumber: async () => {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    
    // Get the count of deals created today
    const sql = `SELECT COUNT(*) as count FROM buyback_deals 
                 WHERE DATE(created_at) = CURDATE()`;
    const [rows] = await db.query(sql);
    const dailyCount = rows[0].count + 1;
    
    return `BB${dateStr}${dailyCount.toString().padStart(3, '0')}`;
  }
};

BuybackDeal.ensureApprovalColumns = ensureBuybackApprovalColumns;

module.exports = BuybackDeal;
