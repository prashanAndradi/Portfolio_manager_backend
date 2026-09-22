const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { getSystemDay } = require('../models/systemDayModel');

function ymd(value) {
  if (!value) return '';
  const s = typeof value === 'string' ? value.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function holdingFace(row) {
  const remaining = Number(row.remaining_face_value);
  if (Number.isFinite(remaining)) return remaining;
  return Number(row.face_value) || 0;
}

function holdingPrice(row) {
  const fromTbill = Number(row.price_per_100);
  if (Number.isFinite(fromTbill) && fromTbill > 0) return fromTbill;
  return Number(row.clean_price) || 0;
}

function instrumentTypeFromIsin(isinNumber) {
  const isin = String(isinNumber || '').trim().toUpperCase();
  if (isin.startsWith('LKA')) return 'T_BILL';
  if (isin.startsWith('LKB')) return 'T_BOND';
  return '';
}

function numOrBlank(value, digits) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toFixed(digits);
}

async function resolveAsAtDate(asAtDate) {
  if (asAtDate) return ymd(asAtDate);
  try {
    const sys = await getSystemDay();
    const fromSys = ymd(sys && sys.system_date);
    if (fromSys) return fromSys;
  } catch (error) {
    console.warn('MTM report could not read system_day:', error.message);
  }
  return new Date().toISOString().slice(0, 10);
}

// GET /api/reports/mark-to-market
router.get('/', async (req, res) => {
  try {
    const {
      series,
      isin,
      maturityDate,
      asAtDate,
      portfolio,
      instrumentType,
      format,
      page = 1,
      pageSize = 20
    } = req.query;
    const effectiveAsAt = await resolveAsAtDate(asAtDate);

    // Portfolio Mark to Market (Finance's layout): per-holding rows valued at the purchased
    // and market yield. Open Sell/Buy buyback positions are excluded.
    if (String(req.query.view || '').toLowerCase() === 'portfolio') {
      const { getPortfolioMarkToMarket } = require('../services/portfolioMtmReportService');
      const result = await getPortfolioMarkToMarket({ asAtDate: effectiveAsAt, portfolio, isin });

      if (format === 'csv' || format === 'excel' || format === 'pdf') {
        const reportExporter = require('../utils/reportExporter');
        const fileBuffer = await reportExporter.exportPortfolioMarkToMarket(format, result);
        const ext = format === 'excel' ? 'xlsx' : format;
        res.setHeader('Content-Disposition', 'attachment; filename=portfolio_mark_to_market.' + ext);
        res.setHeader('Content-Type', reportExporter.getMimeType(format));
        return res.send(fileBuffer);
      }

      const pg = Number(page) || 1;
      const ps = Number(pageSize) || 20;
      const offset = (pg - 1) * ps;
      return res.json({
        data: result.data.slice(offset, offset + ps),
        total: result.data.length,
        totals: result.totals,
        asAtDate: result.asAtDate,
        excluded: result.excluded,
        outstanding: { sells: [], buybacks: [], tbillSells: [] }
      });
    }

    let mtmSql = `
      SELECT
        mtm.series,
        TRIM(mtm.isin_number) as isin,
        mtm.instrument_type,
        mtm.quote_source,
        mtm.isin_issuer,
        mtm.maturity_date,
        mtm.buying_price,
        mtm.selling_price,
        mtm.average_price,
        mtm.buying_yield,
        mtm.selling_yield,
        mtm.average_yield,
        mtm.dirty_price,
        mtm.last_updated,
        mtm.excel_source
      FROM mark_to_market mtm
      WHERE 1=1
    `;
    const mtmParams = [];
    if (series) {
      mtmSql += ' AND mtm.series LIKE ?';
      mtmParams.push(`%${series}%`);
    }
    if (isin) {
      mtmSql += ' AND TRIM(mtm.isin_number) COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci';
      mtmParams.push(String(isin).trim());
    }
    if (maturityDate) {
      mtmSql += ' AND DATE(mtm.maturity_date) = DATE(?)';
      mtmParams.push(maturityDate);
    }
    if (instrumentType) {
      mtmSql += ' AND mtm.instrument_type = ?';
      mtmParams.push(instrumentType);
    }
    mtmSql += ' ORDER BY mtm.instrument_type, mtm.series, mtm.isin_number';

    const [mtmRows] = await db.query(mtmSql, mtmParams);

    const holdingWhere = [
      `(status IS NULL OR status NOT IN ('rejected', 'cancelled'))`,
      `(matured IS NULL OR matured = 0)`,
      `LOWER(COALESCE(transaction_type, 'buy')) = 'buy'`,
      `value_date <= ?`
    ];
    const gsecParams = [effectiveAsAt];
    const tbillParams = [effectiveAsAt];
    if (portfolio) {
      holdingWhere.push('portfolio = ?');
      gsecParams.push(portfolio);
    }
    const gsecSql = `
      SELECT
        TRIM(isin_number) AS isin,
        COALESCE(remaining_face_value, face_value) AS remaining_face_value,
        face_value,
        clean_price,
        NULL AS price_per_100
      FROM gsec
      WHERE ${holdingWhere.join(' AND ')}
    `;
    const tbillWhere = holdingWhere.map((clause) =>
      clause === 'portfolio = ?' ? 'portfolio_id = ?' : clause
    );
    if (portfolio) tbillParams.push(portfolio);
    const tbillSql = `
      SELECT
        TRIM(isin_number) AS isin,
        COALESCE(remaining_face_value, face_value) AS remaining_face_value,
        face_value,
        clean_price,
        price_per_100
      FROM tbill
      WHERE ${tbillWhere.join(' AND ')}
    `;

    const [gsecHoldings] = await db.query(gsecSql, gsecParams);
    const [tbillHoldings] = await db.query(tbillSql, tbillParams);

    const holdingsByIsin = {};
    const addHolding = (row) => {
      const key = String(row.isin || '').trim();
      if (!key) return;
      if (!holdingsByIsin[key]) holdingsByIsin[key] = { balance: 0, sumFV: 0, sumFVCP: 0 };
      const fv = holdingFace(row);
      if (fv <= 0) return;
      const cp = holdingPrice(row);
      holdingsByIsin[key].balance += fv;
      holdingsByIsin[key].sumFV += fv;
      holdingsByIsin[key].sumFVCP += fv * cp;
    };
    gsecHoldings.forEach(addHolding);
    tbillHoldings.forEach(addHolding);

    const rowByIsin = {};
    mtmRows.forEach((row) => {
      const key = String(row.isin || '').trim();
      if (!key) return;
      rowByIsin[key] = {
        series: row.series,
        isin: key,
        instrument_type: row.instrument_type || instrumentTypeFromIsin(key),
        quote_source: row.quote_source || 'excel',
        isin_issuer: row.isin_issuer || '',
        maturity_date: row.maturity_date,
        buying_price: row.buying_price,
        selling_price: row.selling_price,
        average_price: row.average_price,
        buying_yield: row.buying_yield,
        selling_yield: row.selling_yield,
        average_yield: row.average_yield,
        dirty_price: row.dirty_price,
        last_updated: row.last_updated,
        excel_source: row.excel_source || ''
      };
    });

    // SA-09: holdings with no MTM row still appear, marked unpriced.
    const missingIsins = Object.keys(holdingsByIsin).filter((key) => !rowByIsin[key]);
    if (missingIsins.length) {
      const placeholders = missingIsins.map(() => '?').join(',');
      const [masterRows] = await db.query(
        `SELECT TRIM(isin_number) AS isin, series, isin_issuer, maturity_date, coupon_rate
         FROM isin_master
         WHERE TRIM(isin_number) COLLATE utf8mb4_unicode_ci IN (${placeholders})`,
        missingIsins
      );
      const masterByIsin = {};
      masterRows.forEach((row) => {
        masterByIsin[String(row.isin || '').trim()] = row;
      });
      missingIsins.forEach((key) => {
        if (isin && String(isin).trim() !== key) return;
        const master = masterByIsin[key] || {};
        const type = instrumentTypeFromIsin(key) || (Number(master.coupon_rate) > 0 ? 'T_BOND' : 'T_BILL');
        if (instrumentType && type !== instrumentType) return;
        if (series && !(master.series || '').toLowerCase().includes(String(series).toLowerCase())) return;
        if (maturityDate && ymd(master.maturity_date) !== ymd(maturityDate)) return;
        rowByIsin[key] = {
          series: master.series || '',
          isin: key,
          instrument_type: type,
          quote_source: 'unpriced',
          isin_issuer: master.isin_issuer || '',
          maturity_date: master.maturity_date || null,
          buying_price: null,
          selling_price: null,
          average_price: null,
          buying_yield: null,
          selling_yield: null,
          average_yield: null,
          dirty_price: null,
          last_updated: null,
          excel_source: ''
        };
      });
    }

    const allData = Object.values(rowByIsin).map((item) => {
      const holding = holdingsByIsin[item.isin] || { balance: 0, sumFV: 0, sumFVCP: 0 };
      const wap = holding.sumFV > 0 ? holding.sumFVCP / holding.sumFV : 0;
      const markToMarketPrice = Number(item.average_price) || 0;
      const balance = Number(holding.balance) || 0;
      const hasPrice = Number.isFinite(Number(item.average_price));
      const unrealizedGain = hasPrice ? ((markToMarketPrice - wap) * balance) / 100 : 0;

      return {
        series: item.series || '',
        isin: item.isin,
        instrument_type: item.instrument_type || '',
        quote_source: item.quote_source || '',
        isin_issuer: item.isin_issuer || '',
        maturity_date: item.maturity_date,
        buying_price: numOrBlank(item.buying_price, 4),
        selling_price: numOrBlank(item.selling_price, 4),
        average_price: numOrBlank(item.average_price, 4),
        dirty_price: numOrBlank(item.dirty_price, 4),
        buying_yield: numOrBlank(item.buying_yield, 2),
        selling_yield: numOrBlank(item.selling_yield, 2),
        average_yield: numOrBlank(item.average_yield, 2),
        balance: balance.toFixed(2),
        wap: wap ? wap.toFixed(4) : '0.0000',
        unrealized_gain: unrealizedGain.toFixed(4),
        last_updated: item.last_updated,
        excel_source: item.excel_source || ''
      };
    });

    allData.sort((a, b) => {
      const typeCmp = String(a.instrument_type).localeCompare(String(b.instrument_type));
      if (typeCmp) return typeCmp;
      return String(a.series || a.isin).localeCompare(String(b.series || b.isin));
    });

    if (format === 'csv' || format === 'excel' || format === 'pdf') {
      const reportExporter = require('../utils/reportExporter');
      const fileBuffer = await reportExporter.exportMarkToMarket(format, allData);
      res.setHeader('Content-Disposition', `attachment; filename=mark_to_market_report.${format === 'excel' ? 'xlsx' : format}`);
      res.setHeader('Content-Type', reportExporter.getMimeType(format));
      return res.send(fileBuffer);
    }

    const total = allData.length;
    const pg = Number(page) || 1;
    const ps = Number(pageSize) || 20;
    const offset = (pg - 1) * ps;
    const pagedData = allData.slice(offset, offset + ps);

    const [outstandingSells] = await db.query(
      `SELECT deal_number, isin_number AS isin, face_value, value_date, status, current_approval_level
       FROM gsec
       WHERE transaction_type = 'Sell'
         AND status <> 'final_approved' AND status <> 'rejected'
         AND value_date <= ?
       ORDER BY value_date DESC`,
      [effectiveAsAt]
    );

    const [outstandingBuybacks] = await db.query(
      `SELECT deal_number, leg1_isin AS isin, leg1_face_value AS face_value, leg1_value_date AS value_date, deal_status
       FROM buyback_deals
       WHERE deal_status NOT IN ('Approved', 'Rejected', 'Settled')
         AND leg1_value_date <= ?
       ORDER BY leg1_value_date DESC`,
      [effectiveAsAt]
    );

    const [outstandingTbillSells] = await db.query(
      `SELECT deal_number, isin_number AS isin,
              COALESCE(remaining_face_value, face_value) AS face_value,
              value_date, status, current_approval_level
       FROM tbill
       WHERE transaction_type = 'Sell'
         AND status <> 'final_approved' AND status <> 'rejected'
         AND value_date <= ?
       ORDER BY value_date DESC`,
      [effectiveAsAt]
    );

    res.json({
      success: true,
      data: pagedData,
      total,
      page: pg,
      pageSize: ps,
      asAtDate: effectiveAsAt,
      outstanding: {
        sells: outstandingSells,
        buybacks: outstandingBuybacks,
        tbillSells: outstandingTbillSells
      }
    });
  } catch (error) {
    console.error('Error fetching mark-to-market report:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch report', error: error.message });
  }
});

module.exports = router;
