const IsinMaster = require('../models/isinMasterModel');
const IsinCouponSchedule = require('../models/isinCouponSchedule');

exports.createIsin = (req, res) => {
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
};

exports.getAllIsins = (req, res) => {
  IsinMaster.getAll((err, results) => {
    if (err) return res.status(500).json({ success: false, error: err });
    res.json({ success: true, data: results });
  });
};
