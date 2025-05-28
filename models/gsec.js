const db = require('../db');
const LimitSetup = require('./limitSetupModel');

const Gsec = {
  create: (data, callback) => {
    const sql = `INSERT INTO gsec (
      trade_type, transaction_type, counterparty, deal_number, isin, face_value, value_date, next_coupon_date, last_coupon_date, number_of_days_interest_accrued, number_of_days_for_coupon_period, accrued_interest, coupon_interest, clean_price, dirty_price, accrued_interest_calculation, accrued_interest_six_decimals, accrued_interest_for_100, settlement_amount, settlement_mode, issue_date, maturity_date, coupon_dates, yield, brokerage, currency, portfolio, strategy, broker, accrued_interest_adjustment, clean_price_adjustment
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
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
      data.cleanPriceAdjustment
    ];
    
    // First check if this would exceed the counterparty limit
    if (data.counterparty) {
      this.checkGsecLimit(data, (err, limitCheck) => {
        if (err) {
          return callback(err);
        }
        
        if (!limitCheck.allowed) {
          return callback({
            status: 400,
            message: 'GSec limit exceeded',
            details: limitCheck.message,
            limitDetails: limitCheck
          });
        }
        
        // If limit check passes, proceed with the insert
        db.query(sql, values, callback);
      });
    } else {
      // If no counterparty, just insert directly
      db.query(sql, values, callback);
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
  }
};

module.exports = Gsec;
