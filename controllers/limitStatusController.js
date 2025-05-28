const LimitSetup = require('../models/limitSetupModel');
const db = require('../config/db');

exports.getLimitStatus = async (req, res) => {
  try {
    const { counterpartyId, counterpartyType, productType, currency } = req.query;
    
    // Validate required parameters
    if (!counterpartyId || !counterpartyType || !productType || !currency) {
      return res.status(400).json({ 
        error: 'Missing required parameters. Required: counterpartyId, counterpartyType, productType, currency' 
      });
    }
    
    // Get limit setup for this counterparty
    const limits = await LimitSetup.getLimitsByCounterparty(counterpartyId, counterpartyType, currency);
    
    if (!limits) {
      return res.status(404).json({ 
        error: 'No limits configured for this counterparty and currency' 
      });
    }
    
    // Determine which product limit field to check
    let productLimitField = '';
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
        return res.status(400).json({ error: 'Invalid product type' });
    }
    
    // Get current product exposure
    let currentProductExposure = 0;
    
    // Different queries based on product type
    if (productType === 'gsec') {
      // For GSec, check the gsec table
      const [rows] = await db.query(
        `SELECT SUM(face_value) AS total FROM gsec 
         WHERE counterparty = ? AND currency = ?`,
        [counterpartyId, currency]
      );
      currentProductExposure = parseFloat(rows[0]?.total || 0);
    } else {
      // For other products, check the transactions table
      const [rows] = await db.query(
        `SELECT SUM(amount) AS total FROM transactions 
         WHERE counterparty_id = ? AND transaction_type_id IN 
         (SELECT id FROM transaction_types WHERE product_type = ?) AND currency = ?`,
        [counterpartyId, productType, currency]
      );
      currentProductExposure = parseFloat(rows[0]?.total || 0);
    }
    
    // Get overall exposure across all products
    // For a complete implementation, sum up from all product tables
    // This is simplified to just check transactions table
    const [overallRows] = await db.query(
      `SELECT SUM(amount) AS total FROM transactions 
       WHERE counterparty_id = ? AND currency = ?`,
      [counterpartyId, currency]
    );
    const currentOverallExposure = parseFloat(overallRows[0]?.total || 0);
    
    // Get limit values
    const productLimit = parseFloat(limits[productLimitField] || 0);
    const overallLimit = parseFloat(limits.overall_exposure_limit || 0);
    
    // Return the limit status info
    res.json({
      productLimit,
      overallLimit,
      currentProductExposure,
      currentOverallExposure,
      productType,
      currency,
      counterpartyId,
      counterpartyType
    });
  } catch (err) {
    console.error('Error getting limit status:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
