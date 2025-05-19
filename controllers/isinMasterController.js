const IsinMaster = require('../models/isinMasterModel');
const IsinCouponSchedule = require('../models/isinCouponSchedule');

const Gsec = require('../models/gsec');

module.exports = {
  /**
   * Get previous and next coupon dates for a given ISIN and value date
   * GET /api/isin-master/:isin/coupon-dates?valueDate=YYYY-MM-DD
   */
  getCouponDates: (req, res) => {
    const isin = req.params.isin;
    const valueDate = req.query.valueDate;
    if (!isin || !valueDate) {
      return res.status(400).json({ success: false, error: 'ISIN and valueDate are required' });
    }
    IsinCouponSchedule.getPrevAndNextCouponDates(isin, valueDate, (err, result) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: result });
    });
  },

  createIsin: (req, res) => {
    IsinMaster.create(req.body, async (err, result) => {
      if (err) return res.status(500).json({ success: false, error: err });
      // Prepare coupon schedule logic
      try {
        const data = req.body;
        const isin = data.isin_number;
        const issueDate = new Date(data.issue_date);
        const maturityDate = new Date(data.maturity_date);
        const couponRate = parseFloat(data.coupon_rate);
        const faceValue = 100;
        const couponAmount = (couponRate / 2) * faceValue / 100;
        let currentDate = new Date(issueDate);
        let couponNumber = 1;
        const schedule = [];
        // Coupon dates: every 6 months from issue date until before maturity
        while (true) {
          let nextDate = new Date(currentDate);
          nextDate.setMonth(nextDate.getMonth() + 6);
          if (nextDate >= maturityDate) break;
          schedule.push({
            isin,
            coupon_number: couponNumber,
            coupon_date: nextDate.toISOString().slice(0, 10),
            coupon_amount: couponAmount,
            principal: 0
          });
          currentDate = nextDate;
          couponNumber++;
        }
        // Last coupon (maturity)
        schedule.push({
          isin,
          coupon_number: couponNumber,
          coupon_date: maturityDate.toISOString().slice(0, 10),
          coupon_amount: couponAmount,
          principal: faceValue
        });
        // Insert coupon schedule
        IsinCouponSchedule.bulkInsert(schedule, (err2) => {
          if (err2) return res.status(500).json({ success: false, error: err2 });
          res.json({ success: true, id: result.insertId, coupon_schedule_created: true });
        });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    });
  },
  getAllIsins: (req, res) => {
    IsinMaster.getAll((err, results) => {
      if (err) return res.status(500).json({ success: false, error: err });
      res.json({ success: true, data: results });
    });
  },
  searchIsins: (req, res) => {
    const query = req.query.query;
    if (!query) {
      console.error('No query parameter provided');
      return res.status(400).json({ success: false, error: 'Query parameter is required' });
    }
    console.log('Searching ISINs for query:', query);
    IsinMaster.searchByIsin(query, (err, results) => {
      if (err) {
        console.error('Error searching ISINs:', err);
        return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
      }
      console.log('Found ISINs:', results);
      res.json({ success: true, data: results });
    });
  },
  getIsinById: (req, res) => {
    const id = req.params.id;
    IsinMaster.getById(id, (err, result) => {
      if (err) return res.status(500).json({ success: false, error: err });
      if (!result || result.length === 0) return res.status(404).json({ success: false, error: 'ISIN not found' });
      res.json({ success: true, data: result[0] });
    });
  },
  /**
   * Save Gsec transaction to gsec table
   * POST /api/gsec
   */
  saveGsec: (req, res) => {
    Gsec.create(req.body, (err, result) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, message: 'Gsec transaction saved', id: result.insertId });
    });
  }
};
