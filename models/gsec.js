const db = require('../config/database');
const LimitSetup = require('./limitSetupModel');

const Gsec = {
  create: async (data) => {
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
    
    // Calculate dirty price as clean price + accrued interest
    if (data.cleanPrice && data.accruedInterest) {
      data.dirtyPrice = parseFloat(data.cleanPrice) + parseFloat(data.accruedInterest);
    }
    
    const currentDate = new Date();
    
    const sql = `INSERT INTO gsec (
      trade_type, transaction_type, counterparty, deal_number, isin, face_value, value_date, next_coupon_date, 
      last_coupon_date, number_of_days_interest_accrued, number_of_days_for_coupon_period, accrued_interest, 
      coupon_interest, clean_price, dirty_price, accrued_interest_calculation, accrued_interest_six_decimals, 
      accrued_interest_for_100, settlement_amount, settlement_mode, issue_date, maturity_date, coupon_dates, 
      yield, brokerage, currency, portfolio, strategy, broker, accrued_interest_adjustment, clean_price_adjustment, 
      status, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    const values = [
      data.tradeType,
      data.transactionType,
      data.counterparty,
      data.dealNumber,
      data.isin,
      data.faceValue,
      data.valueDate,
      data.nextCouponDate,
      data.lastCouponDate,
      data.numberOfDaysInterestAccrued,
      data.numberOfDaysForCouponPeriod,
      data.accruedInterest,
      data.couponInterest,
      data.cleanPrice,
      data.dirtyPrice,
      data.accruedInterestCalculation,
      data.accruedInterestSixDecimals,
      data.accruedInterestFor100,
      data.settlementAmount,
      data.settlementMode,
      data.issueDate,
      data.maturityDate,
      data.couponDates,
      data.yield,
      data.brokerage,
      data.currency || 'LKR',
      data.portfolio,
      data.strategy,
      data.broker,
      data.accruedInterestAdjustment,
      data.cleanPriceAdjustment,
      'pending', // Default status for authorization workflow
      data.userId || null, // Creator's user ID
      currentDate // Creation timestamp
    ];
    
    try {
      // First check if this would exceed the counterparty limit
      if (data.counterparty) {
        try {
          // We need to implement a promise-based version of checkGsecLimit
          const limitCheck = await Gsec.checkGsecLimitAsync(data);
          
          if (!limitCheck.allowed) {
            const error = {
              status: 400,
              message: 'GSec limit exceeded',
              details: limitCheck.message,
              limitDetails: limitCheck
            };
            throw error;
          }
        } catch (limitErr) {
          throw limitErr;
        }
      }
      
      // If limit check passes or no counterparty, proceed with the insert
      const [result] = await db.query(sql, values);
      return result;
    } catch (error) {
      console.error('Error in create:', error);
      throw error;
    }
  },
  
  // Promise-based version of checkGsecLimit
  checkGsecLimitAsync: async (data) => {
    // First, determine the counterparty type
    const counterpartyId = data.counterparty;
    const amount = parseFloat(data.faceValue || 0);
    const currency = data.currency || 'LKR';
    
    try {
      // Check if it's an individual counterparty
      const [individualRows] = await db.query(
        'SELECT id, "individual" as type FROM counterparty_master_individual WHERE id = ?',
        [counterpartyId]
      );
      
      let counterpartyType;
      if (individualRows && individualRows.length > 0) {
        counterpartyType = 'individual';
        return await Gsec.checkLimitsAsync(counterpartyId, counterpartyType, amount, currency);
      } else {
        // Check if it's a joint counterparty
        const [jointRows] = await db.query(
          'SELECT id, "joint" as type FROM counterparty_master_joint WHERE id = ?',
          [counterpartyId]
        );
        
        if (jointRows && jointRows.length > 0) {
          counterpartyType = 'joint';
          return await Gsec.checkLimitsAsync(counterpartyId, counterpartyType, amount, currency);
        } else {
          return {
            allowed: false,
            message: 'Invalid counterparty ID'
          };
        }
      }
    } catch (error) {
      console.error('Error in checkGsecLimitAsync:', error);
      throw error;
    }
  },
  
  // Promise-based helper function for checking limits
  checkLimitsAsync: async (counterpartyId, counterpartyType, amount, currency) => {
    try {
      // Get the current limit setup for this counterparty
      const [limitRows] = await db.query(
        `SELECT * FROM counterparty_limits 
         WHERE counterparty_id = ? 
         AND counterparty_type = ?
         AND (currency = ? OR currency IS NULL OR currency = '')`,
        [counterpartyId, counterpartyType, currency]
      );
      
      if (!limitRows || limitRows.length === 0) {
        return {
          allowed: false,
          message: 'No limits configured for this counterparty and currency'
        };
      }
      
      const limits = limitRows[0];
      
      // Get current GSec exposure for this counterparty
      const [gsecRows] = await db.query(
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
    // Use a simple query first to debug the issue
    const sql = `SELECT * FROM gsec ORDER BY id DESC LIMIT 100`;
    
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
          // Add default counterparty name since we're not joining tables yet
          counterparty_name: 'Unknown'
        };
      });
      
      return formattedResults;
    } catch (error) {
      console.error('Error in getRecent:', error);
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
    
    // Map data object to SQL SET clauses
    Object.keys(data).forEach(key => {
      // Skip the id field and any fields that are not DB columns
      if (key !== 'id' && key !== 'userId') {
        // Convert camelCase to snake_case for DB fields
        const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        setClauses.push(`${dbField} = ?`);
        values.push(data[key]);
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
      return result;
    } catch (error) {
      console.error('Error in update:', error);
      throw error;
    }
  },
  
  /**
   * Update status of a GSec transaction (approve/reject)
   */
  updateStatus: async (id, data) => {
    const sql = `
      UPDATE gsec 
      SET 
        status = ?,
        comment = ?,
        authorized_by = ?,
        authorized_at = ?
      WHERE id = ?
    `;
    
    const values = [
      data.status,
      data.comment,
      data.authorized_by,
      data.authorized_at,
      id
    ];
    
    try {
      const [result] = await db.query(sql, values);
      return result;
    } catch (error) {
      console.error('Error in updateStatus:', error);
      throw error;
    }
  }
};

module.exports = Gsec;
