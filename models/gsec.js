const db = require('../config/database');
const LimitSetup = require('./limitSetupModel');
const CashflowCaptureService = require('../services/cashflowCaptureService');
const {
  computeGsecPerDayAccrual,
  computeGsecDailyAmortization
} = require('../services/gsecCouponPeriod');
const { buildSoldByDealMap } = require('../services/gsecSellDeductionService');

let gsecColumnEnsurePromise = null;

const ensureGsecColumns = async () => {
  if (!gsecColumnEnsurePromise) {
    gsecColumnEnsurePromise = (async () => {
      const requiredColumns = {
        fund_movement: "VARCHAR(10) NULL DEFAULT 'no'",
        comment: 'TEXT NULL',
        created_by: 'INT NULL',
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
           AND TABLE_NAME = 'gsec'
           AND COLUMN_NAME IN (${placeholders})`,
        columnNames
      );
      const present = new Set((rows || []).map((r) => r.COLUMN_NAME));

      for (const columnName of columnNames) {
        if (present.has(columnName)) continue;
        await db.query(`ALTER TABLE gsec ADD COLUMN ${columnName} ${requiredColumns[columnName]}`);
      }
    })().catch((err) => {
      gsecColumnEnsurePromise = null;
      throw err;
    });
  }
  await gsecColumnEnsurePromise;
};
const Gsec = {
  create: async (data) => {
    // Use the existing create method but with connection pool
    return await Gsec.createWithConnection(data, null);
  },

  createWithConnection: async (data, connection) => {
      await ensureGsecColumns();
      // Auto-generate deal_number if not provided
      const MAX_ATTEMPTS = 5;
      let attempt = 0;
      let lastError;
      while (attempt < MAX_ATTEMPTS) {
        // Always (re)generate deal_number if not provided or after a retry
        if (!data.dealNumber && data.valueDate) {
          let dateObj = new Date(data.valueDate);
          if (!isNaN(dateObj.getTime())) {
            const dateStr = dateObj.getFullYear().toString() +
              String(dateObj.getMonth() + 1).padStart(2, '0') +
              String(dateObj.getDate()).padStart(2, '0');
            data.dealNumber = await Gsec.generateNextDealNumber(dateStr);
          }
        }
      // Handle the financial calculation requirements
      // Ensure accrued interest and clean price are truncated (not rounded) to 4 decimal places
      if (data.accruedInterest) {
        // Truncate to 4 decimal places
        const accruedInterest = Math.floor(parseFloat(data.accruedInterest) * 10000) / 10000;
        data.accruedInterest = accruedInterest;
      }
      
      if (data.cleanPrice) {
        // Truncate to 4 decimal places
        const cleanPrice = Math.floor(parseFloat(data.cleanPrice) * 10000) / 10000;
        data.cleanPrice = cleanPrice;
      }
      
      // Preserve the exact dirty price from frontend (don't recalculate)
      // The frontend has already calculated the correct dirty price
      
      // Only recalculate if dirty price is missing (fallback)
      if (!data.dirtyPrice && data.cleanPrice && data.accruedInterest) {
        data.dirtyPrice = parseFloat(data.cleanPrice) + parseFloat(data.accruedInterest);
      }
      
      // Ensure dirty price is truncated to 4 decimal places (same as frontend)
      if (data.dirtyPrice) {
        data.dirtyPrice = Math.floor(parseFloat(data.dirtyPrice) * 10000) / 10000;
      }
      
      const currentDate = new Date();

      const cleanNumericValue = (value) => {
        if (value === '' || value === null || value === undefined) {
          return null;
        }
        if (typeof value === 'number') {
          return isNaN(value) ? null : value;
        }
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') {
            return null;
          }
          const parsed = parseFloat(trimmed);
          return isNaN(parsed) ? null : parsed;
        }
        return value;
      };
      
      // Calculate per_day_accrual using the same normalized logic as EOD/reporting.
      let perDayAccrual = null;
      if (data.transactionType === 'Buy') {
        const computedPerDay = computeGsecPerDayAccrual(
          {
            face_value: data.faceValue,
            remaining_face_value: data.faceValue,
            coupon_interest: data.couponInterest,
            maturity_date: data.maturityDate,
            isin_number: data.isin,
            coupon_rate: data.couponRate
          },
          data.valueDate || new Date().toISOString().slice(0, 10),
          2
        );
        if (computedPerDay.ok) {
          perDayAccrual = computedPerDay.amount;
        }
      }
      data.per_day_accrual = perDayAccrual;

      let perDayAmortization = null;
      let remainingFaceValue = null;
      if (data.transactionType === 'Buy') {
        const faceForDerived = cleanNumericValue(data.faceValue);
        remainingFaceValue = faceForDerived;
        const amortComputed = computeGsecDailyAmortization({
          face_value: faceForDerived,
          remaining_face_value: faceForDerived,
          clean_price: data.cleanPrice,
          value_date: data.valueDate,
          maturity_date: data.maturityDate
        });
        if (amortComputed.ok) {
          perDayAmortization = amortComputed.dailyAmount;
        }
      }
      data.per_day_amortization = perDayAmortization;
      data.remaining_face_value = remainingFaceValue;

      // Parse counterparty string (e.g., 'i1', 'j1', 'c1') to extract the numeric ID
      let counterpartyId = null;
      if (data.counterparty) {
        const counterpartyStr = String(data.counterparty).trim();
        // Extract numeric part after the prefix (i, j, or c)
        if (counterpartyStr.match(/^[ijc]\d+$/)) {
          // Format: i1, j1, c1, etc.
          counterpartyId = parseInt(counterpartyStr.substring(1), 10);
        } else if (!isNaN(parseInt(counterpartyStr, 10))) {
          // Already a number
          counterpartyId = parseInt(counterpartyStr, 10);
        } else {
          // Try to extract any number from the string
          const match = counterpartyStr.match(/\d+/);
          if (match) {
            counterpartyId = parseInt(match[0], 10);
          }
        }
        
        if (isNaN(counterpartyId) || counterpartyId === null) {
          console.warn(`Warning: Could not parse counterparty ID from: ${data.counterparty}`);
          counterpartyId = null;
        }
      }

      // DB uses counterparty_id and isin_number (after rename from counterparty/isin)
      const counterpartyValue = data.counterparty != null && data.counterparty !== '' ? data.counterparty : counterpartyId;
      const fundMovementValue = String(data.fundMovement || data.fund_movement || 'no').toLowerCase() === 'yes' ? 'yes' : 'no';
      const sql = `INSERT INTO gsec (
        transaction_type, counterparty_id, deal_number, isin_number, face_value, trade_date, value_date, next_coupon_date,
        last_coupon_date, number_of_days_interest_accrued, number_of_days_for_coupon_period, accrued_interest,
        coupon_interest, clean_price, dirty_price, accrued_interest_calculation, accrued_interest_six_decimals,
        accrued_interest_for_100, settlement_amount, settlement_mode, issue_date, maturity_date, coupon_dates,
        yield, brokerage, currency, portfolio, strategy, broker, accrued_interest_adjustment, clean_price_adjustment,
        buy_deal_number, sell_deal_allocations, status, current_approval_level, fund_movement, per_day_accrual, remaining_face_value, per_day_amortization, custodian, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      
      const values = [
        data.transactionType,
        counterpartyValue, // counterparty: prefixed string ('c3') or numeric id for old schema
        data.dealNumber,
        data.isin,
        cleanNumericValue(data.faceValue),
        data.tradeDate || data.valueDate, // Use tradeDate if provided, otherwise fallback to valueDate
        data.valueDate,
        data.nextCouponDate,
        data.lastCouponDate,
        cleanNumericValue(data.numberOfDaysInterestAccrued),
        cleanNumericValue(data.numberOfDaysForCouponPeriod),
        cleanNumericValue(data.accruedInterest),
        cleanNumericValue(data.couponInterest),
        cleanNumericValue(data.cleanPrice),
        cleanNumericValue(data.dirtyPrice),
        data.accruedInterestCalculation,
        cleanNumericValue(data.accruedInterestSixDecimals),
        cleanNumericValue(data.accruedInterestFor100),
        cleanNumericValue(data.settlementAmount),
        data.settlementMode,
        data.issueDate,
        data.maturityDate,
        data.couponDates,
        cleanNumericValue(data.yield),
        cleanNumericValue(data.brokerage),
        data.currency || 'LKR',
        data.portfolio,
        data.strategy,
        data.broker,
        cleanNumericValue(data.accruedInterestAdjustment),
        cleanNumericValue(data.cleanPriceAdjustment),
        data.buyDealNumber || null,
        data.sellDealAllocations ? JSON.stringify(data.sellDealAllocations) : null,
        data.status || 'pending', // Status: pending by default
        data.current_approval_level || 'front_office', // 3-tier: start at front_office for Front Office Verifier
        fundMovementValue,
        cleanNumericValue(data.per_day_accrual),
        cleanNumericValue(data.remaining_face_value),
        cleanNumericValue(data.per_day_amortization),
        data.custodian || null,
        data.created_by || data.createdBy || data.userId || data.user_id || null
      ];
      try {
        // Backend-side validation: prevent overselling from a Buy deal.
        // Multi-lot sells validate each allocation against its own buy deal
        // (summing the whole sell face against buy_deal_number alone would
        // wrongly reject valid multi-lot sells). Includes buyback-linked Sells
        // so Sell/Buy inventory reductions still constrain subsequent sells.
        if (data.transactionType === 'Sell') {
          const allocList = Array.isArray(data.sellDealAllocations)
            ? data.sellDealAllocations
            : null;
          const checks =
            allocList && allocList.length > 0
              ? allocList
                  .map((a) => ({
                    buyDealNumber: a.deal_number || a.buy_deal_number,
                    sellAmount: parseFloat(a.amountToSell || a.faceValue || 0)
                  }))
                  .filter((c) => c.buyDealNumber && c.sellAmount > 0)
              : data.buyDealNumber
                ? [{ buyDealNumber: data.buyDealNumber, sellAmount: parseFloat(data.faceValue || 0) }]
                : [];

          for (const { buyDealNumber, sellAmount } of checks) {
            const [buyRows] = await db.query(
              'SELECT * FROM gsec WHERE deal_number = ? AND transaction_type = "Buy"',
              [buyDealNumber]
            );
            if (!buyRows.length) {
              throw {
                status: 400,
                message: `Referenced Buy deal not found for Sell transaction (${buyDealNumber}).`
              };
            }
            const buyDeal = buyRows[0];
            const buyKey = String(buyDealNumber).trim();
            const [priorSells] = await db.query(
              `SELECT face_value, buy_deal_number, sell_deal_allocations
               FROM gsec
               WHERE transaction_type = 'Sell'
                 AND COALESCE(status, '') NOT IN ('rejected', 'cancelled')
                 AND (
                   TRIM(buy_deal_number) = ?
                   OR sell_deal_allocations IS NOT NULL
                 )`,
              [buyKey]
            );
            let totalSold = 0;
            for (const row of priorSells || []) {
              let parsed = null;
              if (row.sell_deal_allocations) {
                try {
                  parsed =
                    typeof row.sell_deal_allocations === 'string'
                      ? JSON.parse(row.sell_deal_allocations)
                      : row.sell_deal_allocations;
                  if (!Array.isArray(parsed) || !parsed.length) parsed = null;
                } catch {
                  parsed = null;
                }
              }
              if (parsed) {
                for (const a of parsed) {
                  const dn = String(a.deal_number || a.buy_deal_number || '').trim();
                  if (dn === buyKey) {
                    totalSold += Number(a.amountToSell || a.faceValue) || 0;
                  }
                }
              } else if (String(row.buy_deal_number || '').trim() === buyKey) {
                totalSold += Number(row.face_value) || 0;
              }
            }
            const originalFace = parseFloat(buyDeal.face_value || 0);
            const remaining = Math.max(0, originalFace - totalSold);
            if (sellAmount > remaining) {
              throw {
                status: 400,
                message: `Sell amount (${sellAmount}) exceeds remaining face value (${remaining}) for Buy deal ${buyDealNumber}.`
              };
            }
          }
        }
        // Skip limit checking for now to improve performance
        // TODO: Re-enable limit checking after performance optimization
        console.log('=== SKIPPING LIMIT CHECK FOR PERFORMANCE ===');
        // If limit check passes or no counterparty, proceed with the insert
        if (connection) {
          const [result] = await connection.query(sql, values);
          
          // Capture coupon cashflow for Buy transactions (skip letter-only rows)
          if (data.transactionType === 'Buy' && !data.skipCashflowCapture) {
            try {
              await Gsec.captureCouponCashflow(
                result.insertId,
                data.isin,
                data.faceValue,
                data.maturityDate,
                data.counterparty
              );
            } catch (couponError) {
              console.error('Error capturing coupon cashflow:', couponError);
              // Don't fail the main process if coupon capture fails
            }
          }
          
          return result;
        } else {
          const [result] = await db.query(sql, values);
          
          // Capture cashflow for the new GSEC transaction
          if (!data.skipCashflowCapture) {
            try {
              await CashflowCaptureService.captureGsecCashflow(
                result.insertId,
                data.transactionType,
                data.settlementAmount,
                data.valueDate,
                data.counterparty
              );
              
              // Capture coupon cashflow for Buy transactions
              if (data.transactionType === 'Buy') {
                await Gsec.captureCouponCashflow(
                  result.insertId,
                  data.isin,
                  data.faceValue,
                  data.maturityDate,
                  data.counterparty
                );
              }
            } catch (cashflowError) {
              console.error('Error capturing cashflow for GSEC transaction:', cashflowError);
              // Don't fail the main process if cashflow capture fails
            }
          }
          
          return result;
        }
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY' && String(error.sqlMessage).includes('unique_deal_number')) {
          attempt++;
          // Regenerate deal number and retry
          if (data.valueDate) {
            let dateObj = new Date(data.valueDate);
            if (!isNaN(dateObj.getTime())) {
              const dateStr = dateObj.getFullYear().toString() +
                String(dateObj.getMonth() + 1).padStart(2, '0') +
                String(dateObj.getDate()).padStart(2, '0');
              data.dealNumber = await Gsec.generateNextDealNumber(dateStr);
            }
          }
          continue;
        }
        lastError = error;
        break;
      }
    }
    throw lastError || new Error('Failed to generate unique deal number after retries');
  },
  
  // Promise-based version of checkGsecLimit
  checkGsecLimitAsync: async (data, connection = null) => {
    console.log('=== CHECKING GSEC LIMITS (START) ===');
    
    // First, determine the counterparty type
    const counterpartyId = data.counterparty;
    const amount = parseFloat(data.faceValue || 0);
    const currency = data.currency || 'LKR';
    
    // Add validation for counterparty ID
    if (!counterpartyId || counterpartyId === null || counterpartyId === undefined || counterpartyId === '') {
      console.error('Invalid counterparty ID: counterpartyId is null, undefined, or empty');
      return {
        allowed: false,
        message: 'Counterparty ID is required and cannot be empty'
      };
    }
    
    console.log(`Checking limits for counterparty ID: ${counterpartyId}, amount: ${amount}, currency: ${currency}`);
    
    try {
      // Extract the original ID and type from the prefixed ID (i3 -> 3, individual)
      let originalId, counterpartyType;
      if (counterpartyId.startsWith('i')) {
        originalId = counterpartyId.substring(1);
        counterpartyType = 'individual';
      } else if (counterpartyId.startsWith('j')) {
        originalId = counterpartyId.substring(1);
        counterpartyType = 'joint';
      } else if (counterpartyId.startsWith('c')) {
        originalId = counterpartyId.substring(1);
        counterpartyType = 'corporate';
      } else {
        // Fallback for backward compatibility - try to find in any table
        originalId = counterpartyId;
        counterpartyType = null;
      }
      
      console.log(`Extracted original ID: ${originalId}, type: ${counterpartyType}`);
      
      // Optimized: Single query to find counterparty type
      const queryFn = connection ? connection.query.bind(connection) : db.query;
      const [counterpartyRows] = await queryFn(`
        SELECT 'individual' as type FROM counterparty_master_individual WHERE id = ?
        UNION ALL
        SELECT 'joint' as type FROM counterparty_master_joint WHERE id = ?
        UNION ALL
        SELECT 'corporate' as type FROM counterparty_master_corporate WHERE id = ?
        LIMIT 1
      `, [originalId, originalId, originalId]);
      
      if (counterpartyRows && counterpartyRows.length > 0) {
        counterpartyType = counterpartyRows[0].type;
        console.log(`Found counterparty as ${counterpartyType}: ${originalId}`);
        const result = await Gsec.checkLimitsAsync(originalId, counterpartyType, amount, currency, connection);
        console.log('=== CHECKING GSEC LIMITS (END) ===');
        return result;
      } else {
            // Log detailed error information
            console.error(`Counterparty ID ${counterpartyId} (original: ${originalId}) not found in any counterparty table`);
            
            // Check what counterparties exist for debugging
            const [allIndividual] = await queryFn('SELECT id, short_name FROM counterparty_master_individual LIMIT 5');
            const [allJoint] = await queryFn('SELECT id, short_name FROM counterparty_master_joint LIMIT 5');
            const [allCorporate] = await queryFn('SELECT id, short_name FROM counterparty_master_corporate LIMIT 5');
            
            console.log('Available counterparties (first 5 of each type):');
            console.log('Individual:', allIndividual);
            console.log('Joint:', allJoint);
            console.log('Corporate:', allCorporate);
            
            return {
              allowed: false,
              message: `Invalid counterparty ID: ${counterpartyId}. Please select a valid counterparty from the dropdown.`
            };
          }
    } catch (error) {
      console.error('Error in checkGsecLimitAsync:', error);
      throw error;
    }
  },
  
  // Promise-based helper function for checking limits
  checkLimitsAsync: async (counterpartyId, counterpartyType, amount, currency, connection = null) => {
    console.log('=== CHECKING LIMITS (START) ===');
    
    try {
      const queryFn = connection ? connection.query.bind(connection) : db.query;
      
      // Quick check: If amount is 0 or negative, allow immediately
      if (amount <= 0) {
        console.log('=== CHECKING LIMITS (END) - ZERO AMOUNT ===');
        return {
          allowed: true,
          message: 'Zero or negative amount, allowing transaction.'
        };
      }
      
      // Get the current limit setup for this counterparty
      const [limitRows] = await queryFn(
        `SELECT * FROM counterparty_limits 
         WHERE counterparty_id = ? 
         AND counterparty_type = ?
         AND (currency = ? OR currency IS NULL OR currency = '')
         LIMIT 1`,
        [counterpartyId, counterpartyType, currency]
      );
      
      if (!limitRows || limitRows.length === 0) {
        // Allow transaction if no limits are configured
        console.log('=== CHECKING LIMITS (END) - NO LIMITS ===');
        return {
          allowed: true,
          message: 'No limits configured for this counterparty and currency, allowing transaction.'
        };
      }
      
      const limits = limitRows[0];
      
      // Get current GSec exposure for this counterparty
      const [gsecRows] = await queryFn(
        `SELECT SUM(face_value) AS total FROM gsec 
         WHERE counterparty = ? AND currency = ?`,
        [counterpartyId, currency]
      );
      
      const currentGsecExposure = parseFloat(gsecRows[0]?.total || 0);
      
      // Get overall exposure across all products (would need to sum from transactions + gsec + other tables)
      // For simplicity, we're just checking GSec limits here
      
      const gsecLimit = parseFloat(limits.product_gsec_limit || 0);
      const overallLimit = parseFloat(limits.overall_exposure_limit || 0);
      
      // Check if adding the new amount would exceed the GSec limit
      const newGsecExposure = currentGsecExposure + amount;
      
      if (gsecLimit > 0 && newGsecExposure > gsecLimit) {
        console.log('=== CHECKING LIMITS (END) - LIMIT EXCEEDED ===');
        return {
          allowed: false,
          message: `Transaction exceeds GSec limit (${newGsecExposure} > ${gsecLimit})`,
          currentExposure: currentGsecExposure,
          limit: gsecLimit,
          exceededAmount: newGsecExposure - gsecLimit
        };
      }
      
      // For overall limit, we'd need to query all product tables
      // This is simplified for now
      
      console.log('=== CHECKING LIMITS (END) - ALLOWED ===');
      return { allowed: true };
    } catch (error) {
      console.error('Error in checkLimitsAsync:', error);
      throw error;
    }
  },
  
  // Check if a GSec transaction would exceed limits
  checkGsecLimit: (data, callback) => {
    // First, determine the counterparty type
    const counterpartyId = data.counterparty;
    const amount = parseFloat(data.faceValue || 0);
    const currency = data.currency || 'LKR';
    
    // Check if it's an individual counterparty
    db.query(
      'SELECT id, "individual" as type FROM counterparty_master_individual WHERE id = ?',
      [counterpartyId],
      (err, individualRows) => {
        if (err) return callback(err);
        
        let counterpartyType;
        if (individualRows && individualRows.length > 0) {
          counterpartyType = 'individual';
        } else {
          // Check if it's a joint counterparty
          db.query(
            'SELECT id, "joint" as type FROM counterparty_master_joint WHERE id = ?',
            [counterpartyId],
            (err, jointRows) => {
              if (err) return callback(err);
              
              if (jointRows && jointRows.length > 0) {
                counterpartyType = 'joint';
              } else {
                return callback(null, {
                  allowed: false,
                  message: 'Invalid counterparty ID'
                });
              }
              
              // Now check the limits for this counterparty
              checkLimits(counterpartyId, counterpartyType, amount, currency, callback);
            }
          );
          return; // Exit the current function since we're in the async callback
        }
        
        // If we're here, it's an individual counterparty
        checkLimits(counterpartyId, counterpartyType, amount, currency, callback);
      }
    );
    
    function checkLimits(counterpartyId, counterpartyType, amount, currency, callback) {
      // Get the current limit setup for this counterparty
      db.query(
        `SELECT * FROM counterparty_limits 
         WHERE counterparty_id = ? 
         AND counterparty_type = ?
         AND (currency = ? OR currency IS NULL OR currency = '')`,
        [counterpartyId, counterpartyType, currency],
        (err, limitRows) => {
          if (err) return callback(err);
          
          if (!limitRows || limitRows.length === 0) {
            return callback(null, {
              allowed: false,
              message: 'No limits configured for this counterparty and currency'
            });
          }
          
          const limits = limitRows[0];
          
          // Get current GSec exposure for this counterparty
          db.query(
            `SELECT SUM(face_value) AS total FROM gsec 
             WHERE counterparty = ? AND currency = ?`,
            [counterpartyId, currency],
            (err, gsecRows) => {
              if (err) return callback(err);
              
              const currentGsecExposure = parseFloat(gsecRows[0]?.total || 0);
              
              // Get overall exposure across all products (would need to sum from transactions + gsec + other tables)
              // For simplicity, we're just checking GSec limits here
              
              const gsecLimit = parseFloat(limits.product_gsec_limit || 0);
              const overallLimit = parseFloat(limits.overall_exposure_limit || 0);
              
              // Check if adding the new amount would exceed the GSec limit
              const newGsecExposure = currentGsecExposure + amount;
              
              if (gsecLimit > 0 && newGsecExposure > gsecLimit) {
                return callback(null, {
                  allowed: false,
                  message: `Transaction exceeds GSec limit (${newGsecExposure} > ${gsecLimit})`,
                  currentExposure: currentGsecExposure,
                  limit: gsecLimit,
                  exceededAmount: newGsecExposure - gsecLimit
                });
              }
              
              // For overall limit, we'd need to query all product tables
              // This is simplified for now
              
              return callback(null, { allowed: true });
            }
          );
        }
      );
    }
  },
  /**
   * Get recent GSec transactions with associated data
   */
  getRecent: async () => {
    // Query with JOIN to get counterparty short names.
    // DB uses isin_number and counterparty_id (after rename from isin/counterparty).
    const sql = `
      SELECT 
        g.*,
        g.isin_number AS isin,
        COALESCE(
          corp.short_name,
          ind.short_name,
          joint.short_name,
          CONCAT('ID:', g.counterparty_id)
        ) as counterparty_name
      FROM gsec g
      LEFT JOIN counterparty_master_corporate corp ON (g.counterparty_id LIKE 'c%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = corp.id) OR (g.counterparty_id = corp.id)
      LEFT JOIN counterparty_master_individual ind ON (g.counterparty_id LIKE 'i%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = ind.id) OR (g.counterparty_id = ind.id)
      LEFT JOIN counterparty_master_joint joint ON (g.counterparty_id LIKE 'j%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = joint.id) OR (g.counterparty_id = joint.id)
      ORDER BY g.id DESC 
      LIMIT 150
    `;
    
    try {
      const [results] = await db.query(sql);
      
      // Format results to match frontend expectations
      const formattedResults = results.map(transaction => {
        // Ensure all monetary values are displayed with exactly 4 decimal places
        // As per the financial calculation requirements in the memory
        return {
          ...transaction,
          accrued_interest: transaction.accrued_interest ? parseFloat(transaction.accrued_interest).toFixed(4) : null,
          clean_price: transaction.clean_price ? parseFloat(transaction.clean_price).toFixed(4) : null,
          dirty_price: transaction.dirty_price ? parseFloat(transaction.dirty_price).toFixed(4) : null,
          face_value: transaction.face_value ? parseFloat(transaction.face_value).toFixed(2) : null,
          // Use counterparty_name from JOIN, fallback to counterparty ID if not found
          counterparty_name: transaction.counterparty_name || transaction.counterparty_id || 'Unknown'
        };
      });
      // Debug: Log dirty price data being returned
      console.log('=== GETRECENT DIRTY PRICE DEBUG ===');
      if (formattedResults.length > 0) {
        formattedResults.forEach((tx, index) => {
          console.log(`Transaction ${index + 1}:`, {
            id: tx.id,
            isin: tx.isin,
            dirty_price: tx.dirty_price,
            clean_price: tx.clean_price,
            accrued_interest: tx.accrued_interest,
            face_value: tx.face_value
          });
        });
      }
      console.log('==================================');
      
      return formattedResults;
    } catch (error) {
      console.error('Error in getRecent:', error);
      throw error;
    }
  },

  /**
   * All final_approved GSEC deals for a value date (no row cap — settlement letters blotter).
   * @param {string} valueDateYmd YYYY-MM-DD
   */
  getFinalApprovedByValueDate: async (valueDateYmd) => {
    const day = String(valueDateYmd || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new Error('valueDate must be YYYY-MM-DD');
    }
    const sql = `
      SELECT
        g.*,
        g.isin_number AS isin,
        COALESCE(
          corp.short_name,
          ind.short_name,
          joint.short_name,
          CONCAT('ID:', g.counterparty_id)
        ) AS counterparty_name
      FROM gsec g
      LEFT JOIN counterparty_master_corporate corp ON (g.counterparty_id LIKE 'c%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = corp.id) OR (g.counterparty_id = corp.id)
      LEFT JOIN counterparty_master_individual ind ON (g.counterparty_id LIKE 'i%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = ind.id) OR (g.counterparty_id = ind.id)
      LEFT JOIN counterparty_master_joint joint ON (g.counterparty_id LIKE 'j%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = joint.id) OR (g.counterparty_id = joint.id)
      WHERE LOWER(TRIM(g.status)) = 'final_approved'
        AND DATE(g.value_date) = DATE(?)
      ORDER BY g.id DESC
    `;
    const [results] = await db.query(sql, [day]);
    return (results || []).map((transaction) => ({
      ...transaction,
      accrued_interest: transaction.accrued_interest != null ? parseFloat(transaction.accrued_interest).toFixed(4) : null,
      clean_price: transaction.clean_price != null ? parseFloat(transaction.clean_price).toFixed(4) : null,
      dirty_price: transaction.dirty_price != null ? parseFloat(transaction.dirty_price).toFixed(4) : null,
      face_value: transaction.face_value != null ? parseFloat(transaction.face_value).toFixed(2) : null,
      counterparty_name: transaction.counterparty_name || transaction.counterparty_id || 'Unknown'
    }));
  },

  /**
   * Look up source Buy rows by deal number (for sell / buyback authorizer slips).
   */
  getBuyDealsByDealNumbers: async (dealNumbers) => {
    const unique = [...new Set(
      (dealNumbers || []).map((d) => String(d).trim()).filter(Boolean)
    )];
    if (!unique.length) return [];

    const placeholders = unique.map(() => '?').join(',');
    const [rows] = await db.query(
      `SELECT deal_number, yield, face_value, remaining_face_value,
              isin_number AS isin, portfolio, value_date
       FROM gsec
       WHERE transaction_type = 'Buy' AND deal_number IN (${placeholders})`,
      unique
    );
    return rows;
  },

  /**
   * Get Buy deals with remaining face value (original - total sold from this deal)
   * Only for display, does not update Buy record. Uses buy_deal_number in Sell transactions.
   * Filtered by ISIN and/or portfolio if provided.
   */
  getBuyDealsWithBalanceFiltered: async (isin, portfolio, asAtDate = null) => {
    // Build SQL with optional filters - show approved deals with remaining balance
    let sql = `SELECT 
      id,
      deal_number,
      isin_number AS isin,
      yield,
      face_value,
      remaining_face_value,
      portfolio,
      value_date,
      transaction_type,
      status,
      custodian
    FROM gsec 
    WHERE transaction_type = 'Buy' 
      AND status IN ('Approved', 'Settled', 'final_approved')`;
    const params = [];
    if (isin) {
      sql += ' AND isin_number = ?';
      params.push(isin);
    }
    if (portfolio) {
      sql += ' AND portfolio = ?';
      params.push(portfolio);
    }
    // Filter by date if provided (for historical reports)
    if (asAtDate) {
      sql += ' AND value_date <= ?';
      params.push(asAtDate);
    }
    sql += ' ORDER BY deal_number DESC';
    
    const [rows] = await db.query(sql, params);
    
    // Calculate remaining face value dynamically by subtracting sell transactions.
    // Uses the allocation-aware map (same as the GSec report): multi-lot Sells
    // store their true per-buy-deal split in sell_deal_allocations, and summing
    // the whole sell face_value against buy_deal_number would over-deduct the
    // primary deal (hiding it from the sell modal) while under-deducting the
    // other allocated deals. Excludes rejected Sells - a rejected Sell never
    // executed, so it must not keep counting against the Buy deal's
    // available-to-sell balance (see also Gsec.updateStatus, which restores
    // remaining_face_value on rejection for the same reason).
    const dealNumbers = rows.map(r => r.deal_number).filter(Boolean);
    const soldByDeal = await buildSoldByDealMap(db, dealNumbers, asAtDate, { excludeRejected: true });
    
    // Always calculate buyback deductions (approved sell/buy legs reduce available balance)
    const buybackDeductionsByDeal = {};
    if (dealNumbers.length) {
      // Detect whether sell_deal_allocations column exists so we can honour
      // the precise per-deal amounts stored at buyback creation time.
      let hasSellDealAllocationsColumn = false;
      try {
        const [allocCols] = await db.query(`
          SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'buyback_deals'
            AND COLUMN_NAME = 'sell_deal_allocations'
          LIMIT 1
        `);
        hasSellDealAllocationsColumn = Array.isArray(allocCols) && allocCols.length > 0;
      } catch (_) { /* leave false */ }

      const modalIsins = [...new Set(rows.map(r => (r.isin || '').trim()).filter(Boolean))];
      const placeholders = dealNumbers.map(() => '?').join(',');
      const isinPh = modalIsins.length ? modalIsins.map(() => '?').join(',') : "'__none__'";
      const effectiveCutoff = asAtDate || new Date().toISOString().split('T')[0];
      let buybackSql = `
        SELECT source_buy_deal_number, leg1_face_value, leg1_isin${hasSellDealAllocationsColumn ? ', sell_deal_allocations' : ''},
               (leg2_value_date IS NOT NULL AND DATE(leg2_value_date) <= DATE(?)) AS leg2_settled
        FROM buyback_deals
        WHERE leg1_transaction_type = 'Sell'
        AND deal_status = 'Approved'
        AND approved_at IS NOT NULL AND DATE(leg1_value_date) <= DATE(?)
        AND (source_buy_deal_number IN (${placeholders}) OR (source_buy_deal_number IS NULL AND leg1_isin IN (${isinPh})))
        ORDER BY DATE(leg1_value_date) ASC, id ASC
      `;
      const buybackParams = [effectiveCutoff, effectiveCutoff, ...dealNumbers, ...modalIsins];
      
      const [buybackRows] = await db.query(buybackSql, buybackParams);

      // Build ISIN → deal list for FIFO allocation of NULL-source buybacks
      const modalBuysByIsin = {};
      rows.forEach(r => {
        const dn = (r.deal_number || '').trim();
        const dealIsin = (r.isin || '').trim();
        if (!dn || !dealIsin) return;
        if (!modalBuysByIsin[dealIsin]) modalBuysByIsin[dealIsin] = [];
        modalBuysByIsin[dealIsin].push({ deal_number: dn, face_value: Number(r.face_value) || 0 });
      });

      const allocModalFIFO = (isin, amount, skipDeal) => {
        const candidates = modalBuysByIsin[isin];
        if (!candidates) return amount;
        let remaining = amount;
        for (const c of candidates) {
          if (remaining <= 0) break;
          if (skipDeal && c.deal_number === skipDeal) continue;
          const alreadyDeducted = Number(buybackDeductionsByDeal[c.deal_number] || 0);
          const sold = Number(soldByDeal[c.deal_number] || 0);
          const available = Math.max(0, c.face_value - sold - alreadyDeducted);
          if (available <= 0) continue;
          const alloc = Math.min(remaining, available);
          buybackDeductionsByDeal[c.deal_number] = alreadyDeducted + alloc;
          remaining -= alloc;
        }
        return remaining;
      };

      // Two-pass processing (mirrors services/gsecReportService.js):
      // Pass 1 uses precise per-deal amounts from sell_deal_allocations.
      // Pass 2 uses source_buy_deal_number + FIFO fallback for rows without allocations.
      const parseBBAllocs = (r) => {
        if (!r.sell_deal_allocations) return null;
        try {
          const a = typeof r.sell_deal_allocations === 'string'
            ? JSON.parse(r.sell_deal_allocations)
            : r.sell_deal_allocations;
          return Array.isArray(a) && a.length > 0 ? a : null;
        } catch (_) { return null; }
      };

      const bbWithAllocs = [];
      const bbWithoutAllocs = [];
      for (const row of buybackRows) {
        (parseBBAllocs(row) ? bbWithAllocs : bbWithoutAllocs).push(row);
      }

      for (const row of bbWithAllocs) {
        parseBBAllocs(row).forEach(a => {
          const dealNo = (a.deal_number || '').trim();
          const alloc = Number(a.amountToSell) || 0;
          if (dealNo && alloc > 0) {
            buybackDeductionsByDeal[dealNo] = (Number(buybackDeductionsByDeal[dealNo] || 0)) + alloc;
          }
        });
      }

      bbWithoutAllocs.forEach(row => {
        const key = (row.source_buy_deal_number || '').trim();
        const amount = Number(row.leg1_face_value) || 0;
        if (key) {
          const alreadyDeducted = Number(buybackDeductionsByDeal[key] || 0);
          const srcInfo = modalBuysByIsin[row.leg1_isin]?.find(c => c.deal_number === key);
          const srcFV = srcInfo ? srcInfo.face_value : 0;
          const sold = Number(soldByDeal[key] || 0);
          const capacity = Math.max(0, srcFV - sold - alreadyDeducted);
          const directAlloc = Math.min(amount, capacity);
          if (directAlloc > 0) buybackDeductionsByDeal[key] = alreadyDeducted + directAlloc;
          const overflow = amount - directAlloc;
          if (overflow > 0 && row.leg1_isin) {
            allocModalFIFO(row.leg1_isin, overflow, key);
          }
        } else if (row.leg1_isin) {
          // No source deal and no allocations (legacy buybacks entered before allocations
          // existed): the sold lots are unknown, so the leg-1 face is spread FIFO over the
          // ISIN's deals. Once leg 2 has settled the bond is back in the book, so stop
          // deducting - otherwise the old sell floats onto whatever deals are held today.
          if (Number(row.leg2_settled) === 1) return;
          allocModalFIFO(row.leg1_isin, amount, null);
        }
      });
    }

    return rows.map(deal => {
      const originalFace = Number(deal.face_value) || 0;
      const soldAmount = Number(soldByDeal[deal.deal_number] || 0);
      const buybackDeduction = Number(buybackDeductionsByDeal[deal.deal_number] || 0);

      // Always compute dynamically: original - gsec sells - buyback sells
      // This is the most reliable method as it doesn't depend on remaining_face_value being kept in sync.
      const remainingFace = Math.max(0, originalFace - soldAmount - buybackDeduction);
      
      return {
        ...deal,
        face_value: originalFace.toFixed(2),
        remaining_face_value: remainingFace.toFixed(4)
      };
    }).filter(deal => Number(deal.remaining_face_value) > 0);
  },

  /**
   * Get the Sell history against a single Buy deal - i.e. every Sell row that
   * references this Buy deal's deal_number, in date order, with a running
   * remaining-face-value column. Used by the GSec Portfolio Report's
   * "click Face Value to see history" drill-down, so a user can see exactly
   * how today's remaining face value was arrived at from the original Buy.
   * Excludes rejected Sells - a rejected Sell never executed, so it isn't
   * part of the deal's real history (same exclusion as
   * getBuyDealsWithBalanceFiltered above).
   */
  getSellHistoryForBuyDeal: async (buyDealNumber) => {
    const [buyRows] = await db.query(
      `SELECT deal_number, face_value, isin_number, portfolio FROM gsec WHERE deal_number = ? AND transaction_type = 'Buy' LIMIT 1`,
      [buyDealNumber]
    );
    const buyDeal = buyRows && buyRows[0];
    if (!buyDeal) return { buyDealNumber, originalFaceValue: 0, sells: [] };

    const [sellRows] = await db.query(
      `SELECT deal_number, value_date, trade_date, face_value, status, settlement_amount, yield, counterparty_id
       FROM gsec
       WHERE transaction_type = 'Sell' AND buy_deal_number = ? AND status <> 'rejected'
       ORDER BY value_date ASC, id ASC`,
      [buyDealNumber]
    );

    const originalFaceValue = Number(buyDeal.face_value) || 0;
    let runningRemaining = originalFaceValue;
    const sells = sellRows.map((s) => {
      const soldAmount = Number(s.face_value) || 0;
      runningRemaining = Math.max(0, runningRemaining - soldAmount);
      return {
        deal_number: s.deal_number,
        value_date: s.value_date,
        trade_date: s.trade_date,
        face_value_sold: soldAmount,
        remaining_after: runningRemaining,
        status: s.status,
        settlement_amount: s.settlement_amount,
        yield: s.yield,
        counterparty: s.counterparty_id
      };
    });

    return {
      buyDealNumber,
      isin: buyDeal.isin_number,
      portfolio: buyDeal.portfolio,
      originalFaceValue,
      remainingFaceValue: runningRemaining,
      sells
    };
  },

  /**
   * Total available (remaining) face value for an ISIN/portfolio as of a
   * given date - i.e. the "opening balance" for that date if asOfDate is the
   * day before. Reuses getBuyDealsWithBalanceFiltered (already excludes
   * rejected Sells and accounts for buyback deductions) rather than
   * duplicating that balance logic - sums remaining_face_value across every
   * Buy deal for the ISIN/portfolio still holding balance as of that date.
   * Shared by the Maturity Blotter's opening-balance line and the Daily
   * Portfolio Balancing Report.
   */
  getOpeningBalance: async (isin, portfolio, asOfDate) => {
    const deals = await Gsec.getBuyDealsWithBalanceFiltered(isin, portfolio, asOfDate);
    return deals.reduce((sum, d) => sum + (Number(d.remaining_face_value) || 0), 0);
  },

  /**
   * Get all Buy deals with remaining face value (original - total sold from this deal)
   * Only for display, does not update Buy record. Uses buy_deal_number in Sell transactions.
   */
  getBuyDealsWithBalance: async () => {
    // Get all Buy deals - only finally approved
    const buySql = `SELECT * FROM gsec WHERE transaction_type = 'Buy' AND status = 'final_approved' ORDER BY id DESC`;
    // Get total sold per buy_deal_number (Sell transactions reference Buy deals).
    // Excludes rejected Sells - see getBuyDealsWithBalanceFiltered for why.
    const sellSql = `SELECT buy_deal_number, SUM(face_value) AS total_sold FROM gsec WHERE transaction_type = 'Sell' AND status <> 'rejected' GROUP BY buy_deal_number`;
    try {
      const [buyDeals] = await db.query(buySql);
      const [sellAgg] = await db.query(sellSql);
      // Map of buy_deal_number => total_sold
      const soldMap = {};
      for (const row of sellAgg) {
        soldMap[row.buy_deal_number] = parseFloat(row.total_sold || 0);
      }
      // Compose results
      return buyDeals.map(deal => {
        const originalFace = parseFloat(deal.face_value || 0);
        const sold = soldMap[deal.deal_number] || 0;
        const remaining = Math.max(0, originalFace - sold);
        return {
          ...deal,
          accrued_interest: deal.accrued_interest ? parseFloat(deal.accrued_interest).toFixed(4) : null,
          clean_price: deal.clean_price ? parseFloat(deal.clean_price).toFixed(4) : null,
          dirty_price: deal.dirty_price ? parseFloat(deal.dirty_price).toFixed(4) : null,
          face_value: (Math.trunc(originalFace * 10000) / 10000).toFixed(4),
          remaining_face_value: (Math.trunc(remaining * 10000) / 10000).toFixed(4),
          counterparty_name: 'Unknown'
        };
      });
    } catch (error) {
      console.error('Error in getBuyDealsWithBalance:', error);
      throw error;
    }
  },

  /**
   * Get only GSec deals with transaction_type = 'Buy'
   */
  getBuyDeals: async () => {
    const sql = `SELECT * FROM gsec WHERE transaction_type = 'Buy' AND status = 'final_approved' ORDER BY id DESC`;
    try {
      const [results] = await db.query(sql);
      // Format results for frontend (truncate/format decimals as in getRecent)
      return results.map(transaction => ({
        ...transaction,
        accrued_interest: transaction.accrued_interest ? parseFloat(transaction.accrued_interest).toFixed(4) : null,
        clean_price: transaction.clean_price ? parseFloat(transaction.clean_price).toFixed(4) : null,
        dirty_price: transaction.dirty_price ? parseFloat(transaction.dirty_price).toFixed(4) : null,
        face_value: transaction.face_value ? parseFloat(transaction.face_value).toFixed(2) : null,
        counterparty_name: 'Unknown'
      }));
    } catch (error) {
      console.error('Error in getBuyDeals:', error);
      throw error;
    }
  },
  
  /**
   * Update an existing GSec transaction
   */
  update: async (id, data) => {
    // Handle the financial calculation requirements
    // Ensure accrued interest and clean price are truncated (not rounded) to 4 decimal places
    if (data.accrued_interest) {
      // Truncate to 4 decimal places
      const accruedInterest = Math.floor(parseFloat(data.accrued_interest) * 10000) / 10000;
      data.accrued_interest = accruedInterest;
    }
    
    if (data.clean_price) {
      // Truncate to 4 decimal places
      const cleanPrice = Math.floor(parseFloat(data.clean_price) * 10000) / 10000;
      data.clean_price = cleanPrice;
    }
    
    // Calculate dirty price as clean price + accrued interest
    if (data.clean_price && data.accrued_interest) {
      data.dirty_price = parseFloat(data.clean_price) + parseFloat(data.accrued_interest);
    }
    
    // Generate SET clause for SQL
    const setClauses = [];
    const values = [];
    
    // Whitelist of valid database columns in gsec table (based on actual schema)
    const validColumns = [
      'trade_type', 'transaction_type', 'counterparty_id', 'deal_number', 'buy_deal_number', 'isin_number', 'face_value',
      'value_date', 'trade_date', 'next_coupon_date', 'last_coupon_date', 'number_of_days_interest_accrued',
      'number_of_days_for_coupon_period', 'accrued_interest', 'daily_accrual', 'coupon_interest', 'clean_price',
      'dirty_price', 'per_day_accrual', 'per_day_amortization', 'accrued_interest_calculation', 'accrued_interest_six_decimals',
      'accrued_interest_for_100', 'settlement_amount', 'settlement_mode', 'issue_date',
      'maturity_date', 'coupon_dates', 'yield', 'portfolio', 'clean_price_adjustment',
      'accrued_interest_adjustment', 'broker', 'strategy', 'stratergy', 'status', 'created_by',
      'created_at', 'updated_by', 'updated_at',
      'current_approval_level', 'brokerage', 'currency',
      'remaining_face_value', 'matured', 'sell_back_amount', 'fund_movement', 'custodian'
    ];
    
    // Resolve actual columns from DB so updates are schema-aware
    const [dbColumns] = await db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'gsec'`
    );
    const existingColumns = new Set((dbColumns || []).map((c) => c.COLUMN_NAME));

    // Map data object to SQL SET clauses
    Object.keys(data).forEach(key => {
      // Skip the id field and any fields that are not DB columns
      if (key !== 'id' && key !== 'userId') {
        // Convert camelCase to snake_case for DB fields
        const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        
        // Only include fields that are valid and actually exist in current schema
        if (validColumns.includes(dbField) && existingColumns.has(dbField)) {
        setClauses.push(`${dbField} = ?`);
        values.push(data[key]);
        }
      }
    });
    
    if (setClauses.length === 0) {
      throw new Error('No fields to update');
    }
    
    // Add ID to values array for WHERE clause
    values.push(id);
    
      const sql = `UPDATE gsec SET ${setClauses.join(', ')} WHERE id = ?`;
    
    try {
      const [result] = await db.query(sql, values);
      const [afterRows] = await db.query('SELECT id, deal_number, transaction_type, status, current_approval_level, face_value, settlement_amount, clean_price, dirty_price, value_date, maturity_date, remaining_face_value, per_day_accrual, per_day_amortization, coupon_interest, isin_number FROM gsec WHERE id = ?', [id]);
      const after = afterRows && afterRows[0];
      if (
        after &&
        after.transaction_type === 'Buy' &&
        (after.remaining_face_value == null ||
          after.per_day_amortization == null ||
          after.per_day_accrual == null)
      ) {
        try {
          await Gsec.ensureBuyDerivedFields(after);
        } catch (deriveErr) {
          console.error('Failed to backfill GSec buy derived fields on update:', deriveErr);
        }
      }
      return result;
    } catch (error) {
      console.error('Error in update:', error);
      throw error;
    }
  },
  
  /**
   * Backfill remaining_face_value, per_day_accrual, per_day_amortization on Buy rows when missing
   * (e.g. deals rejected/resubmitted before final approval, or legacy rows).
   */
  ensureBuyDerivedFields: async (idOrRow, connection = null) => {
    const runQuery = async (sql, params) => {
      if (connection) {
        const [rows] = await connection.query(sql, params);
        return rows;
      }
      const [rows] = await db.query(sql, params);
      return rows;
    };
    const runExec = async (sql, params) => {
      if (connection) {
        return connection.query(sql, params);
      }
      return db.query(sql, params);
    };

    let row = typeof idOrRow === 'object' && idOrRow !== null ? idOrRow : null;
    if (!row) {
      const rows = await runQuery('SELECT * FROM gsec WHERE id = ?', [idOrRow]);
      if (!rows.length) return { updated: false };
      row = rows[0];
    }
    if (row.transaction_type !== 'Buy') return { updated: false };

    const face = Number(row.face_value) || 0;
    if (face <= 0) return { updated: false };

    const setParts = [];
    const values = [];

    const needsRfv = row.remaining_face_value == null || row.remaining_face_value === '';
    const remainingForCalc = needsRfv ? face : Number(row.remaining_face_value) || face;
    if (needsRfv) {
      setParts.push('remaining_face_value = ?');
      values.push(face);
    }

    if ((row.per_day_accrual == null || row.per_day_accrual === '') && row.coupon_interest) {
      let couponRate = null;
      let couponDate1 = null;
      let couponDate2 = null;
      if (row.isin_number) {
        const isinRows = await runQuery(
          `SELECT coupon_rate, coupon_date_1, coupon_date_2
           FROM isin_master WHERE isin_number = ? LIMIT 1`,
          [row.isin_number]
        );
        if (isinRows[0]) {
          couponRate = isinRows[0].coupon_rate;
          couponDate1 = isinRows[0].coupon_date_1;
          couponDate2 = isinRows[0].coupon_date_2;
        }
      }
      const reductionForGuard = Math.max(0, face - remainingForCalc);
      const computed = computeGsecPerDayAccrual(
        {
          face_value: face,
          remaining_face_value: remainingForCalc,
          coupon_interest: row.coupon_interest,
          maturity_date: row.maturity_date,
          isin_number: row.isin_number,
          coupon_rate: couponRate,
          coupon_date_1: couponDate1,
          coupon_date_2: couponDate2,
          // Pass total known reduction so the safety guard doesn't reset
          // remaining back to face when stored RFV reflects real buyback/sell deductions.
          linked_reduced_face_value: reductionForGuard
        },
        row.value_date || new Date().toISOString().slice(0, 10),
        2
      );
      if (computed.ok) {
        setParts.push('per_day_accrual = ?');
        values.push(computed.amount);
        if (
          computed.E &&
          (row.number_of_days_for_coupon_period == null || row.number_of_days_for_coupon_period === '')
        ) {
          setParts.push('number_of_days_for_coupon_period = ?');
          values.push(computed.E);
        }
      }
    }

    if (row.per_day_amortization == null || row.per_day_amortization === '') {
      const amort = computeGsecDailyAmortization({
        face_value: face,
        remaining_face_value: remainingForCalc,
        clean_price: row.clean_price,
        value_date: row.value_date,
        maturity_date: row.maturity_date
      });
      if (amort.ok) {
        setParts.push('per_day_amortization = ?');
        values.push(amort.dailyAmount);
      }
    }

    if (!setParts.length) {
      return { updated: false, row };
    }

    values.push(row.id);
    await runExec(`UPDATE gsec SET ${setParts.join(', ')}, updated_at = NOW() WHERE id = ?`, values);
    const refreshed = await runQuery('SELECT * FROM gsec WHERE id = ?', [row.id]);
    return { updated: true, row: refreshed[0] || row };
  },

  /**
   * Update status of a GSec transaction (approve/reject)
   */
  updateStatus: async (id, data) => {
    // First, fetch the current transaction to get the actual current_approval_level
    const [currentTx] = await db.query('SELECT current_approval_level, status FROM gsec WHERE id = ?', [id]);
    if (!currentTx || currentTx.length === 0) {
      throw new Error('Transaction not found');
    }
    
    const currentLevel = (currentTx[0] && currentTx[0].current_approval_level) || 'front_office';
    const previousStatus = (currentTx[0] && currentTx[0].status) || null;
    let newStatus = data.status;
    let newApprovalLevel;
    let finalApproval = false;
    // Which approver-tracking column to stamp with data.userId for this transition,
    // keyed by the tier that is being *completed* (i.e. the level before the update).
    let approverColumn = null;

    if (data.status === 'approved') {
      // 3-tier: advance front_office -> back_office_verifier -> back_office_final -> final_approved
      if (currentLevel === 'front_office') {
        newApprovalLevel = 'back_office_verifier';
        newStatus = 'pending';
        approverColumn = 'front_office_by';
      } else if (currentLevel === 'back_office_verifier') {
        newApprovalLevel = 'back_office_final';
        newStatus = 'pending';
        approverColumn = 'back_office_verifier_by';
      } else if (currentLevel === 'back_office_final') {
        newApprovalLevel = 'final_approved';
        newStatus = 'final_approved';
        finalApproval = true;
        approverColumn = 'final_approved_by';
      } else {
        newApprovalLevel = currentLevel;
        newStatus = newStatus === 'final_approved' ? 'final_approved' : 'pending';
      }
    } else if (data.status === 'rejected') {
      // Bounce rejected deals out of every auth blotter. Status stays
      // 'rejected' and the level returns to front_office so the create
      // page can show Edit & Resubmit to front-office users.
      newStatus = 'rejected';
      newApprovalLevel = 'front_office';
    } else {
      newApprovalLevel = currentLevel;
    }
    
    // Best-effort: make sure the `comment` column exists before we try to
    // write to it. If the schema migration can't run (older DB, perms, etc.)
    // we silently fall back to the legacy UPDATE without the comment column.
    let commentColumnAvailable = true;
    try {
      await ensureGsecColumns();
    } catch (ensureErr) {
      console.warn('ensureGsecColumns failed during updateStatus; will skip comment column write:', ensureErr?.message || ensureErr);
      commentColumnAvailable = false;
    }
    if (commentColumnAvailable) {
      try {
        const [colRows] = await db.query(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gsec' AND COLUMN_NAME = 'comment'`
        );
        commentColumnAvailable = Array.isArray(colRows) && colRows.length > 0;
      } catch (probeErr) {
        commentColumnAvailable = false;
      }
    }

    const wantsCommentWrite = Object.prototype.hasOwnProperty.call(data, 'comment') && data.comment !== undefined;
    const hasComment = wantsCommentWrite && commentColumnAvailable;

    // Same best-effort pattern as the comment column above: only stamp the
    // approver column if it actually exists (ensureGsecColumns should have
    // just created it, but don't hard-fail the approval if that didn't happen).
    let approverColumnAvailable = false;
    if (approverColumn && data.userId != null) {
      try {
        const [colRows] = await db.query(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gsec' AND COLUMN_NAME = ?`,
          [approverColumn]
        );
        approverColumnAvailable = Array.isArray(colRows) && colRows.length > 0;
      } catch (probeErr) {
        approverColumnAvailable = false;
      }
    }

    const setClauses = ['status = ?', 'current_approval_level = ?'];
    const values = [newStatus, newApprovalLevel];
    if (hasComment) {
      setClauses.push('comment = ?');
      values.push(data.comment || null);
    }
    if (approverColumnAvailable) {
      setClauses.push(`${approverColumn} = ?`);
      values.push(data.userId);
    }
    values.push(id);
    const sql = `UPDATE gsec SET ${setClauses.join(', ')} WHERE id = ?`;

    try {
      const [result] = await db.query(sql, values);

      // If a Sell deal is being rejected, release the face value it locked
      // against its linked Buy deal's remaining_face_value. The deduction
      // happens at Sell *creation* time (see isinMasterController.saveGsec),
      // before any approval - so if the Sell never executes, that hold must
      // be given back, otherwise the Buy deal's available balance stays
      // permanently short by the rejected amount. Guarded on previousStatus
      // !== 'rejected' so re-rejecting an already-rejected row (shouldn't
      // normally happen, but defensively) doesn't double-restore.
      if (newStatus === 'rejected' && previousStatus !== 'rejected') {
        try {
          const [txRows] = await db.query(
            'SELECT transaction_type, buy_deal_number, face_value FROM gsec WHERE id = ?',
            [id]
          );
          const tx = txRows && txRows[0];
          if (tx && tx.transaction_type === 'Sell' && tx.buy_deal_number) {
            const [buyRows] = await db.query(
              'SELECT id, face_value, remaining_face_value FROM gsec WHERE deal_number = ? AND transaction_type = "Buy"',
              [tx.buy_deal_number]
            );
            const buyDeal = buyRows && buyRows[0];
            if (buyDeal) {
              const currentRemaining = parseFloat(buyDeal.remaining_face_value ?? buyDeal.face_value ?? 0);
              const restored = currentRemaining + parseFloat(tx.face_value || 0);
              await db.query('UPDATE gsec SET remaining_face_value = ? WHERE id = ?', [restored.toFixed(4), buyDeal.id]);
              await Gsec.syncFutureCouponCashflowsForBuyDeal(tx.buy_deal_number);
            }
          }
        } catch (restoreErr) {
          console.error('Failed to restore remaining_face_value on Sell rejection:', restoreErr);
          // Don't throw - the status update itself already succeeded.
        }
      }

      // If finally approved, create ledger entries
      if (finalApproval) {
        try {
          // Fetch the full transaction details
          const [updatedTx] = await db.query('SELECT * FROM gsec WHERE id = ?', [id]);
          if (updatedTx && updatedTx.length > 0) {
            let transaction = updatedTx[0];

            if (transaction.transaction_type === 'Buy') {
              try {
                const derived = await Gsec.ensureBuyDerivedFields(transaction);
                if (derived.row) transaction = derived.row;
              } catch (deriveErr) {
                console.error('Failed to backfill GSec buy derived fields on approval:', deriveErr);
              }
            }
            
            // Check if ledger entries already exist for this deal
            const [existingEntries] = await db.query(
              'SELECT COUNT(*) as cnt FROM ledger_entries WHERE deal_number = ?',
              [transaction.deal_number]
            );
            
            if (existingEntries[0].cnt === 0) {
              const gsecApprovalLedgerService = require('../services/gsecApprovalLedgerService');
              if (transaction.transaction_type === 'Buy') {
                const ledgerResult = await gsecApprovalLedgerService.postFinalApprovedBuyLedger(transaction);
                if (!ledgerResult.success) {
                  console.error('Failed to post GSec compound ledger entry:', ledgerResult.error);
                }
                return result;
              }
              if (transaction.transaction_type === 'Sell') {
                const ledgerResult = await gsecApprovalLedgerService.postFinalApprovedSellLedger(transaction);
                if (!ledgerResult.success) {
                  console.error('Failed to post GSec sell ledger:', ledgerResult.error);
                }
                return result;
              }
              console.warn(`Unknown transaction type: ${transaction.transaction_type}, skipping ledger entry`);
              return result;
            } else {
              console.log(`Ledger entries already exist for deal ${transaction.deal_number}, skipping creation`);
            }
          }
        } catch (err) {
          console.error('Failed to post GSec ledger entry:', err);
          // Don't throw error, just log it so the status update still succeeds
        }
      }
      
      return result;
    } catch (error) {
      console.error('Error in updateStatus:', error);
      throw error;
    }
  }
};

Gsec.getLatestDealNumber = async (date, connection) => {
  // date should be in YYYYMMDD format for the new pattern.
  // Use the caller's transaction connection when supplied (e.g. multi-lot Sell
  // creation loops that INSERT more than once inside one open transaction) so
  // this SELECT sees prior uncommitted inserts from the same transaction —
  // otherwise every leg computes the same "next" number and collides.
  const runner = connection || db;
  const [results] = await runner.query(
    'SELECT deal_number FROM gsec WHERE deal_number LIKE ? ORDER BY deal_number DESC LIMIT 1',
    [`${date}/GSEC/%`]
  );
  const latest = results[0] ? results[0].deal_number : null;
  return latest;
};

/**
 * Generate the next deal number for GSec in the format GSEC-YYYY-MM-DD-###
 * @param {string} date - in YYYY-MM-DD format
 * @param {object} [connection] - transaction connection to read through, so
 *   uncommitted inserts from the same transaction are visible (see getLatestDealNumber).
 * @returns {string} nextDealNumber
 */
Gsec.generateNextDealNumber = async (date, connection) => {
  try {
    // Get the latest deal number for this date
    const latest = await Gsec.getLatestDealNumber(date, connection);
    let nextSeq = 1;
    
    if (latest) {
      const parts = latest.split('/');
      if (parts.length >= 3) {
        const seqStr = parts[2]; // Get the sequence part (0001, 0002, etc.)
        const seqNum = parseInt(seqStr, 10);
        if (!isNaN(seqNum)) {
          nextSeq = seqNum + 1;
        }
      }
    }
    
    const padded = String(nextSeq).padStart(4, '0');
    const nextDeal = `${date}/GSEC/${padded}`;
    return nextDeal;
  } catch (error) {
    console.error('[ERROR] Failed to generate deal number:', error);
    // Fallback to timestamp-based unique number
    const timestamp = Date.now().toString().slice(-4);
    return `${date}/GSEC/${timestamp}`;
  }
};


/**
 * Get all GSec transactions at a specific approval level
 */
Gsec.getTransactionsByApprovalLevel = async (approvalLevel) => {
  const sql = `SELECT * FROM gsec WHERE current_approval_level = ? ORDER BY id DESC`;
  try {
    const [results] = await db.query(sql, [approvalLevel]);
    // Format results for frontend display (truncate/format decimals)
    return results.map(transaction => ({
      ...transaction,
      accruedInterest: transaction.accrued_interest ? parseFloat(transaction.accrued_interest).toFixed(4) : null,
      cleanPrice: transaction.clean_price ? parseFloat(transaction.clean_price).toFixed(4) : null,
      dirtyPrice: transaction.dirty_price ? parseFloat(transaction.dirty_price).toFixed(4) : null,
      faceValue: transaction.face_value ? parseFloat(transaction.face_value).toFixed(4) : null,
      dealNumber: transaction.deal_number,
      tradeDate: transaction.trade_date,
      security: transaction.security || transaction.isin,
      status: transaction.status
    }));
  } catch (error) {
    console.error('Error in getTransactionsByApprovalLevel:', error);
    throw error;
  }
};

/**
 * Advance approval level for a transaction (1->2->3, then mark as final)
 */
Gsec.advanceApprovalLevel = async (id) => {
  // Fetch the transaction
  const [results] = await db.query('SELECT * FROM gsec WHERE id = ?', [id]);
  if (!results.length) return null;
  const tx = results[0];
  let finalApproval = false;
  
  // Single approval level - directly mark as final_approved
  const updateFields = ", status = 'final_approved', current_approval_level = 'final_approved'";
  finalApproval = true;
  
  await db.query(`UPDATE gsec SET updated_at = NOW()${updateFields} WHERE id = ?`, [id]);
  // Return updated transaction
  const [updated] = await db.query('SELECT * FROM gsec WHERE id = ?', [id]);

  // If finally approved, post ledger entry
  if (finalApproval) {
    try {
      const ledgerController = require('../controllers/ledgerController');
      const accountMapping = require('../services/accountMappingService');
      const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ASSET_TBONDS);
      const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT);
      
      await ledgerController.postLedgerEntry({
        date: new Date().toISOString().slice(0, 10),
        dr_account: drAccount,
        cr_account: crAccount,
        amount: Number(updated[0].face_value),
        deal_id: updated[0].deal_number,
        description: 'GSec Purchase - Final Approval'
      });
    } catch (err) {
      console.error('Failed to post GSec ledger entry:', err);
      // Optionally: update transaction with error status/field
    }
  }
  return updated[0];
};

Gsec.getTransactionsByPortfolio = async (portfolioId) => {
  const sql = "SELECT * FROM gsec WHERE portfolio = ? AND transaction_type = 'Buy' AND status = 'final_approved'";
  const [rows] = await db.query(sql, [portfolioId]);
  return rows;
};

/**
 * Backfill ledger entries for final_approved GSEC transactions that don't have ledger entries
 * This function can be called to fix missing ledger entries for existing transactions
 */
Gsec.backfillLedgerEntries = async (transactionId = null) => {
  try {
    const gsecApprovalLedgerService = require('../services/gsecApprovalLedgerService');

    // Build query to find final_approved transactions without ledger entries
    let query = `
      SELECT g.* 
      FROM gsec g
      WHERE g.status = 'final_approved'
        AND NOT EXISTS (
          SELECT 1 FROM ledger_entries le 
          WHERE le.deal_number = g.deal_number
        )
    `;
    let params = [];
    
    // If specific transaction ID provided, filter by it
    if (transactionId) {
      query += ' AND g.id = ?';
      params.push(transactionId);
    }
    
    const [transactions] = await db.query(query, params);
    
    if (transactions.length === 0) {
      return {
        success: true,
        message: transactionId 
          ? 'Transaction already has ledger entries or is not final_approved'
          : 'No transactions found that need ledger entries',
        processed: 0
      };
    }
    
    let processed = 0;
    let errors = [];
    
    for (const transaction of transactions) {
      try {
        const amount = Number(transaction.settlement_amount || transaction.face_value || 0);

        if (amount === 0) {
          errors.push(`Transaction ${transaction.deal_number}: Amount is zero, skipping`);
          continue;
        }

        if (transaction.transaction_type === 'Buy') {
          try {
            const derived = await Gsec.ensureBuyDerivedFields(transaction);
            if (derived.row) transaction = derived.row;
          } catch (deriveErr) {
            console.error(`backfillLedgerEntries: derived fields failed for ${transaction.deal_number}:`, deriveErr);
          }
          const ledgerResult = await gsecApprovalLedgerService.postFinalApprovedBuyLedger(transaction);
          if (!ledgerResult.success) {
            errors.push(`Transaction ${transaction.deal_number}: Failed to post compound ledger entry - ${ledgerResult.error}`);
          } else {
            processed++;
            console.log(`Backfilled compound ledger entries for GSEC Buy transaction ${transaction.deal_number}`);
          }
          continue;
        }

        if (transaction.transaction_type === 'Sell') {
          const sellRes = await gsecApprovalLedgerService.postFinalApprovedSellLedger(transaction);
          if (!sellRes.success) {
            errors.push(`Transaction ${transaction.deal_number}: ${sellRes.error || 'Sell ledger failed'}`);
            continue;
          }
          processed++;
          continue;
        }

        errors.push(`Transaction ${transaction.deal_number}: Unknown transaction type ${transaction.transaction_type}, skipping`);
      } catch (err) {
        errors.push(`Transaction ${transaction.deal_number}: ${err.message}`);
        console.error(`Error processing transaction ${transaction.deal_number}:`, err);
      }
    }
    
    return {
      success: true,
      message: `Processed ${processed} transaction(s)`,
      processed,
      total: transactions.length,
      errors: errors.length > 0 ? errors : undefined
    };
  } catch (error) {
    console.error('Error in backfillLedgerEntries:', error);
    return {
      success: false,
      error: error.message,
      processed: 0
    };
  }
};

// Get maturities by date (without deal status filtering as requested)
Gsec.getMaturitiesByDate = async (date) => {
  const query = `
    SELECT 
      g.id,
      g.deal_number,
      g.isin_number AS isin,
      g.counterparty_id AS counterparty,
      COALESCE(
        corp.short_name,
        ind.short_name,
        joint.short_name,
        g.counterparty_id
      ) as counterparty_name,
      g.face_value,
      g.settlement_amount,
      g.accrued_interest,
      g.maturity_date,
      g.status as deal_status,
      DATEDIFF(g.maturity_date, CURDATE()) as days_to_maturity
    FROM gsec g
    LEFT JOIN counterparty_master_corporate corp ON (g.counterparty_id LIKE 'c%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = corp.id) OR (g.counterparty_id = corp.id)
    LEFT JOIN counterparty_master_individual ind ON (g.counterparty_id LIKE 'i%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = ind.id) OR (g.counterparty_id = ind.id)
    LEFT JOIN counterparty_master_joint joint ON (g.counterparty_id LIKE 'j%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = joint.id) OR (g.counterparty_id = joint.id)
    WHERE g.maturity_date <= ?
      AND COALESCE(g.matured, 0) = 0
    ORDER BY g.maturity_date ASC
  `;
  
  const [rows] = await db.query(query, [date]);
  return rows;
};

// Capture coupon cashflow for GSEC Buy transactions
Gsec.captureCouponCashflow = async (dealId, isin, faceValue, maturityDate, counterparty) => {
  try {
    console.log(`Capturing coupon cashflow for GSEC deal ${dealId}, ISIN: ${isin}`);
    
    // Get coupon schedule for this ISIN
    const [couponRows] = await db.query(`
      SELECT coupon_date, coupon_amount, principal
      FROM isin_coupon_schedule 
      WHERE isin COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci
        AND coupon_date > CURDATE() AND coupon_date <= ?
      ORDER BY coupon_date
    `, [isin, maturityDate]);
    
    if (couponRows.length === 0) {
      console.log(`No coupon schedule found for ISIN ${isin}`);
      return 0;
    }
    
    // Get cashflow categories
    const [categories] = await db.query(`
      SELECT id, name, type FROM cashflow_categories WHERE is_active = TRUE
    `);
    
    const categoryMap = {};
    categories.forEach(cat => {
      categoryMap[cat.name.toLowerCase()] = cat;
    });
    
    const interestCategory = categoryMap['interest income'];
    if (!interestCategory) {
      console.log('Interest Income category not found');
      return 0;
    }
    
    let capturedCount = 0;
    
    // Create cashflow entries for each coupon payment
    for (const coupon of couponRows) {
      // Calculate coupon amount for this face value
      // coupon_amount is per 100 face value, so scale it
      const couponAmount = (parseFloat(coupon.coupon_amount) * parseFloat(faceValue)) / 100;
      
      if (couponAmount > 0) {
        await db.query(`
          INSERT INTO cashflow_transactions 
          (category_id, transaction_date, amount, flow_type, currency, description, reference_number, counterparty, status)
          VALUES (?, ?, ?, 'inflow', 'LKR', ?, ?, ?, 'confirmed')
        `, [
          interestCategory.id,
          coupon.coupon_date,
          couponAmount,
          `GSEC Coupon Payment - ISIN ${isin}`,
          `GSEC-${dealId}-COUPON-${coupon.coupon_date}`,
          counterparty
        ]);
        
        capturedCount++;
        console.log(`Captured coupon cashflow: ${couponAmount} on ${coupon.coupon_date}`);
      }
    }
    
    console.log(`Captured ${capturedCount} coupon cashflow entries for GSEC deal ${dealId}`);
    return capturedCount;
    
  } catch (error) {
    console.error('Error capturing coupon cashflow:', error);
    throw error;
  }
};

// Re-sync future coupon cashflows for a Buy deal based on current remaining_face_value.
// This keeps forecast coupon inflows aligned after partial/full pre-maturity exits.
Gsec.syncFutureCouponCashflowsForBuyDeal = async (buyDealNumber, connection = null) => {
  const queryFn = connection ? connection.query.bind(connection) : db.query;
  try {
    const [buyRows] = await queryFn(
      `SELECT id, deal_number, isin_number, maturity_date, face_value, remaining_face_value, counterparty_id
       FROM gsec
       WHERE deal_number = ? AND transaction_type = 'Buy'
       LIMIT 1`,
      [buyDealNumber]
    );
    if (!buyRows || buyRows.length === 0) {
      return 0;
    }

    const buyDeal = buyRows[0];
    const dealId = buyDeal.id;
    const isin = buyDeal.isin_number;
    const maturityDate = buyDeal.maturity_date;
    const remainingFace = Number(buyDeal.remaining_face_value || buyDeal.face_value || 0);

    await queryFn(
      `DELETE FROM cashflow_transactions
       WHERE reference_number LIKE ?
         AND transaction_date > CURDATE()`,
      [`GSEC-${dealId}-COUPON-%`]
    );

    if (!Number.isFinite(remainingFace) || remainingFace <= 0) {
      return 0;
    }

    const [couponRows] = await queryFn(
      `SELECT coupon_date, coupon_amount
       FROM isin_coupon_schedule
       WHERE isin COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci
         AND coupon_date > CURDATE() AND coupon_date <= ?
       ORDER BY coupon_date`,
      [isin, maturityDate]
    );
    if (!couponRows || couponRows.length === 0) {
      return 0;
    }

    const [categories] = await queryFn(
      `SELECT id, name FROM cashflow_categories WHERE is_active = TRUE`
    );
    const interestCategory = (categories || []).find(
      (c) => String(c.name || '').toLowerCase() === 'interest income'
    );
    if (!interestCategory) {
      return 0;
    }

    let capturedCount = 0;
    for (const coupon of couponRows) {
      const couponPer100 = Number(coupon.coupon_amount || 0);
      if (!Number.isFinite(couponPer100) || couponPer100 <= 0) {
        continue;
      }
      const couponAmount = (couponPer100 * remainingFace) / 100;
      if (!Number.isFinite(couponAmount) || couponAmount <= 0) {
        continue;
      }

      await queryFn(
        `INSERT INTO cashflow_transactions
         (category_id, transaction_date, amount, flow_type, currency, description, reference_number, counterparty, status)
         VALUES (?, ?, ?, 'inflow', 'LKR', ?, ?, ?, 'confirmed')`,
        [
          interestCategory.id,
          coupon.coupon_date,
          couponAmount,
          `GSEC Coupon Payment - ISIN ${isin}`,
          `GSEC-${dealId}-COUPON-${coupon.coupon_date}`,
          buyDeal.counterparty_id
        ]
      );
      capturedCount++;
    }

    return capturedCount;
  } catch (error) {
    console.error('Error syncing future coupon cashflow for buy deal:', buyDealNumber, error);
    throw error;
  }
};

Gsec.ensureColumns = ensureGsecColumns;

module.exports = Gsec;
