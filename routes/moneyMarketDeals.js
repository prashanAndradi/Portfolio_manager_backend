const express = require('express');
const router = express.Router();

// Import Prisma client
const prisma = require('../prismaClient');

// POST /api/money-market-deals - Save a new deal
router.post('/', async (req, res) => {
  const deal = req.body;
  try {
    // Format date to YYYYMMDD
    const tradeDate = new Date(deal.tradeDate);
    const yyyy = tradeDate.getFullYear();
    const mm = String(tradeDate.getMonth() + 1).padStart(2, '0');
    const dd = String(tradeDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}${mm}${dd}`;
    const productCode = deal.productType;

    // Get max sequence for this date and product using Prisma
    const lastDeal = await prisma.money_market_deals.findFirst({
      where: {
        trade_date: new Date(deal.tradeDate),
        product_type: productCode
      },
      orderBy: { deal_number: 'desc' },
      select: { deal_number: true },
    });
    let nextSeq = 1;
    if (lastDeal) {
      const lastSeq = parseInt(lastDeal.deal_number.slice(-4), 10);
      nextSeq = lastSeq + 1;
    }
    const seqStr = String(nextSeq).padStart(4, '0');
    const dealNumber = `${dateStr}${productCode}${seqStr}`;

    // Create new deal using Prisma
    const result = await prisma.money_market_deals.create({
      data: {
        deal_number: dealNumber,
        trade_date: new Date(deal.tradeDate),
        value_date: new Date(deal.valueDate),
        maturity_date: new Date(deal.maturityDate),
        counterparty_id: deal.counterpartyId,
        product_type: deal.productType,
        currency: deal.currency,
        principal_amount: deal.principalAmount,
        interest_rate: deal.interestRate,
        tenor: deal.tenor,
        interest_amount: deal.interestAmount,
        maturity_value: deal.maturityValue,
        settlement_mode: deal.settlementMode,
        remarks: deal.remarks
      }
    });
    res.status(201).json({ success: true, message: 'Deal saved', id: result.id, dealNumber });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to save deal', error: err.message });
  }
});

// GET /api/money-market-deals - List all deals
router.get('/', async (req, res) => {
  try {
    const rows = await prisma.money_market_deals.findMany({
      orderBy: { trade_date: 'desc' }
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch deals', error: err.message });
  }
});

module.exports = router;
