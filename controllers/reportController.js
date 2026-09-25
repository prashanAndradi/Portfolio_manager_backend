const gsecReportService = require('../services/gsecReportService');
const portfolioReportService = require('../services/portfolioReportService');
const portfolioOutstandingService = require('../services/portfolioOutstandingService');
const counterpartyReportService = require('../services/counterpartyReportService');
const buybackReportService = require('../services/buybackReportService');
const repoReportService = require('../services/repoReportService');
const tbillReportService = require('../services/tbillReportService');
const brokerReportService = require('../services/brokerReportService');
const dailyPortfolioBalanceService = require('../services/dailyPortfolioBalanceService');
const accountReportFiguresService = require('../services/accountReportFiguresService');
const reportExporter = require('../utils/reportExporter');

// GET /api/reports/gsec
exports.getGsecReport = async (req, res) => {
  try {
    console.log('=== GSEC REPORT API CALLED ===');
    console.log('Query params:', req.query);
    
    const {
      asAtDate,
      portfolio,
      isin,
      valueDate,
      maturityDate,
      dateFrom,
      dateTo,
      format,
      page,
      pageSize,
      summaryOnly,
      view
    } = req.query;

    const isSummaryOnly = summaryOnly === '1' || summaryOnly === 'true';
    const isTransactions = String(view || '').toLowerCase() === 'transactions'
      || String(view || '').toLowerCase() === 'transaction';

    // Validate required params
    if (isTransactions) {
      if (!dateFrom && !dateTo && !asAtDate && !valueDate && !isin) {
        return res.status(400).json({ error: 'A date range (From/To) or ISIN is required' });
      }
    } else if (!asAtDate && !isin) {
      return res.status(400).json({ error: 'Either asAtDate or ISIN is required' });
    }

    // Fetch report data
    const reportParams = {
      asAtDate,
      portfolio,
      isin,
      valueDate,
      maturityDate,
      dateFrom,
      dateTo,
      view
    };
    
    // Only add pagination if provided (for regular display)
    if (page && pageSize) {
      reportParams.page = Number(page);
      reportParams.pageSize = Number(pageSize);
    }
    
    const { data, total, totalPortfolioBalance, summary } = await gsecReportService.getGsecReport(reportParams);

    console.log('GSEC Report Service returned:');
    console.log('Data length:', data.length);
    console.log('First few face values:');
    data.slice(0, 2).forEach(row => {
      console.log(`- ${row.deal_number}: face_value=${row.face_value}`);
    });

    // Handle export formats
    if (format === 'csv' || format === 'excel' || format === 'pdf') {
      const isTransactions = String(view || '').toLowerCase() === 'transactions'
        || String(view || '').toLowerCase() === 'transaction';
      if (isSummaryOnly) {
        // ISIN-wise summary report (its own tab) – export summary only
        const fileBuffer = await reportExporter.exportGsecSummary(format, summary || []);
        res.setHeader('Content-Disposition', `attachment; filename=t_bond_summary_report.${format === 'excel' ? 'xlsx' : format}`);
        res.setHeader('Content-Type', reportExporter.getMimeType(format));
        return res.send(fileBuffer);
      }
      // Use GSec exporter so all GSec report fields are included
      const fileBuffer = isTransactions
        ? await reportExporter.exportGsecTransactions(format, data)
        : await reportExporter.export(format, data);
      const filename = isTransactions
        ? `t_bond_transactions_report.${format === 'excel' ? 'xlsx' : format}`
        : `t_bond_report.${format === 'excel' ? 'xlsx' : format}`;
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      res.setHeader('Content-Type', reportExporter.getMimeType(format));
      return res.send(fileBuffer);
    }

    // Default: return JSON (paginated if page/pageSize provided, otherwise all data)
    const response = { data, total };
    if (page && pageSize) {
      response.page = Number(page);
      response.pageSize = Number(pageSize);
    }
    if (totalPortfolioBalance !== null) {
      response.totalPortfolioBalance = totalPortfolioBalance;
    }
    if (summary) {
      response.summary = summary;
    }
    res.json(response);
  } catch (err) {
    console.error('GSec Report Error:', err);
    console.error('Error stack:', err.stack);
    console.error('Error message:', err.message);
    console.error('Error code:', err.code);
    console.error('Error sqlState:', err.sqlState);
    console.error('Error sqlMessage:', err.sqlMessage);
    res.status(500).json({ 
      error: 'Failed to generate GSec report',
      details: err.message || 'Unknown error',
      sqlError: err.sqlMessage || err.code || undefined,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};

// GET /api/reports/portfolio
exports.getPortfolioReport = async (req, res) => {
  try {
    console.log('=== PORTFOLIO REPORT API CALLED ===');
    console.log('Query params:', req.query);
    
    const {
      asAtDate,
      startDate,
      endDate,
      product,
      portfolio,
      isin,
      format,
      page,
      pageSize
    } = req.query;

    // As-at reporting. startDate/endDate stay supported for older callers.
    if (!asAtDate && !(startDate && endDate)) {
      return res.status(400).json({ error: 'As at date is required' });
    }

    // `view` selects the report type. Anything other than the two new as-at
    // views falls through to the original deal-listing report unchanged, so
    // existing callers (and saved links) keep behaving exactly as before.
    const view = String(req.query.view || 'detailed').toLowerCase();
    if (view === 'outstanding' || view === 'summary') {
      if (!asAtDate) {
        return res.status(400).json({ error: 'As at date is required' });
      }
      const isExport = format === 'csv' || format === 'excel' || format === 'pdf';
      const outstandingParams = { asAtDate, portfolio, isin };
      if (view === 'outstanding' && !isExport) {
        outstandingParams.page = page ? Number(page) : undefined;
        outstandingParams.pageSize = pageSize ? Number(pageSize) : undefined;
      }
      const result =
        view === 'summary'
          ? await portfolioOutstandingService.getPortfolioSummary(outstandingParams)
          : await portfolioOutstandingService.getPortfolioOutstanding(outstandingParams);

      if (isExport) {
        const fileBuffer = view === 'summary'
          ? await reportExporter.exportPortfolioSummary(format, result.data, result.totals, asAtDate)
          : await reportExporter.exportPortfolioOutstanding(format, result.data, result.totals, asAtDate);
        const filename = view === 'summary'
          ? `portfolio_summary_report.${format === 'excel' ? 'xlsx' : format}`
          : `portfolio_outstanding_report.${format === 'excel' ? 'xlsx' : format}`;
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.setHeader('Content-Type', reportExporter.getMimeType(format));
        return res.send(fileBuffer);
      }

      return res.json(result);
    }

    // Fetch report data
    const reportParams = {
      asAtDate,
      startDate,
      endDate,
      product,
      portfolio
    };
    
    // Handle export formats - skip pagination to export all data
    if (format === 'csv' || format === 'excel' || format === 'pdf') {
      // Don't apply pagination for exports - get all data
      const { data } = await portfolioReportService.getPortfolioReport(reportParams);
      console.log('Portfolio Report Export - Data length:', data.length);
      
      // Use portfolio-specific exporter to include all portfolio fields
      const fileBuffer = await reportExporter.exportPortfolio(format, data);
      res.setHeader('Content-Disposition', `attachment; filename=portfolio_report.${format === 'excel' ? 'xlsx' : format}`);
      res.setHeader('Content-Type', reportExporter.getMimeType(format));
      return res.send(fileBuffer);
    }
    
    // Only add pagination if provided (for regular display)
    if (page && pageSize) {
      reportParams.page = Number(page);
      reportParams.pageSize = Number(pageSize);
    }
    
    const { data, total } = await portfolioReportService.getPortfolioReport(reportParams);

    console.log('Portfolio Report Service returned:');
    console.log('Data length:', data.length);
    console.log('Total:', total);

    // Default: return JSON (paginated if page/pageSize provided, otherwise all data)
    const response = { data, total };
    if (page && pageSize) {
      response.page = Number(page);
      response.pageSize = Number(pageSize);
    }
    res.json(response);
  } catch (err) {
    console.error('Portfolio Report Error:', err);
    res.status(500).json({ error: 'Failed to generate Portfolio report', details: err.message });
  }
};

// GET /api/reports/counterparty
exports.getCounterpartyReport = async (req, res) => {
  try {
    console.log('=== COUNTERPARTY REPORT API CALLED ===');
    console.log('Query params:', req.query);
    
    const {
      counterparty,
      nicNumber,
      name,
      dateFrom,
      dateTo,
      format,
      page,
      pageSize
    } = req.query;

    // Fetch report data
    const reportParams = {
      counterparty,
      nicNumber,
      name,
      dateFrom,
      dateTo
    };
    
    // Only add pagination if provided (for regular display)
    if (page && pageSize) {
      reportParams.page = Number(page);
      reportParams.pageSize = Number(pageSize);
    }
    
    const { data, total } = await counterpartyReportService.getCounterpartyReport(reportParams);

    console.log('Counterparty Report Service returned:');
    console.log('Data length:', data.length);
    console.log('Total:', total);

    // Handle export formats
    if (format === 'csv' || format === 'excel' || format === 'pdf') {
      const fileBuffer = await reportExporter.export(format, data);
      res.setHeader('Content-Disposition', `attachment; filename=counterparty_transaction_report.${format === 'excel' ? 'xlsx' : format}`);
      res.setHeader('Content-Type', reportExporter.getMimeType(format));
      return res.send(fileBuffer);
    }

    // Default: return JSON (paginated if page/pageSize provided, otherwise all data)
    const response = { data, total };
    if (page && pageSize) {
      response.page = Number(page);
      response.pageSize = Number(pageSize);
    }
    res.json(response);
  } catch (err) {
    console.error('Counterparty Report Error:', err);
    res.status(500).json({ error: 'Failed to generate Counterparty report', details: err.message });
  }
};

// GET /api/reports/counterparty-master
exports.getCounterpartyMasterReport = async (req, res) => {
  try {
    console.log('=== COUNTERPARTY MASTER REPORT API CALLED ===');
    console.log('Query params:', req.query);
    
    const {
      type,
      format,
      page,
      pageSize
    } = req.query;

    // Fetch report data
    const reportParams = {
      type: type || 'all'
    };
    
    // Only add pagination if provided (for regular display)
    if (page && pageSize) {
      reportParams.page = Number(page);
      reportParams.pageSize = Number(pageSize);
    }
    
    const { data, total } = await counterpartyReportService.getAllCounterpartyMasterDetails(reportParams);

    console.log('Counterparty Master Report Service returned:');
    console.log('Data length:', data.length);
    console.log('Total:', total);

    // Handle export formats
    if (format === 'csv' || format === 'excel' || format === 'pdf') {
      const fileBuffer = await reportExporter.exportCounterpartyMaster(format, data);
      res.setHeader('Content-Disposition', `attachment; filename=counterparty_master_report.${format === 'excel' ? 'xlsx' : format}`);
      res.setHeader('Content-Type', reportExporter.getMimeType(format));
      return res.send(fileBuffer);
    }

    // Default: return JSON (paginated if page/pageSize provided, otherwise all data)
    const response = { data, total };
    if (page && pageSize) {
      response.page = Number(page);
      response.pageSize = Number(pageSize);
    }
    res.json(response);
  } catch (err) {
    console.error('Counterparty Master Report Error:', err);
    res.status(500).json({ error: 'Failed to generate Counterparty Master report', details: err.message });
  }
};

// GET /api/reports/buyback
exports.getBuybackReport = async (req, res) => {
  try {
    console.log('=== BUYBACK REPORT API CALLED ===');
    console.log('Query params:', req.query);
    
    const {
      asAtDate,
      portfolio,
      isin,
      valueDate,
      maturityDate,
      dateFrom,
      dateTo,
      transactionPair,
      format,
      page,
      pageSize,
      view
    } = req.query;

    // Fetch report data
    const reportParams = {
      asAtDate,
      portfolio,
      isin,
      valueDate,
      maturityDate,
      dateFrom,
      dateTo,
      transactionPair,
      view
    };
    
    // Only add pagination if provided (for regular display)
    if (page && pageSize) {
      reportParams.page = Number(page);
      reportParams.pageSize = Number(pageSize);
    }
    
    const { data, total, totalPortfolioBalance } = await buybackReportService.getBuybackReport(reportParams);

    console.log('Buyback Report Service returned:');
    console.log('Data length:', data.length);
    console.log('Total:', total);

    // Handle export formats
    if (format === 'csv' || format === 'excel' || format === 'pdf') {
      const fileBuffer = await reportExporter.exportBuyback(format, data);
      const isTransactions = String(view || '').toLowerCase() === 'transactions'
        || String(view || '').toLowerCase() === 'transaction';
      const filename = isTransactions
        ? `buyback_transactions_report.${format === 'excel' ? 'xlsx' : format}`
        : `buyback_report.${format === 'excel' ? 'xlsx' : format}`;
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      res.setHeader('Content-Type', reportExporter.getMimeType(format));
      return res.send(fileBuffer);
    }

    // Default: return JSON (paginated if page/pageSize provided, otherwise all data)
    const response = { data, total };
    if (page && pageSize) {
      response.page = Number(page);
      response.pageSize = Number(pageSize);
    }
    if (totalPortfolioBalance !== null) {
      response.totalPortfolioBalance = totalPortfolioBalance;
    }
    res.json(response);
  } catch (err) {
    console.error('Buyback Report Error:', err);
    res.status(500).json({ error: 'Failed to generate Buyback report', details: err.message });
  }
};

// GET /api/reports/repo
exports.getRepoReport = async (req, res) => {
  try {
    console.log('=== REPO REPORT API CALLED ===');
    console.log('Query params:', req.query);

    const {
      asAtDate,
      portfolio,
      isin,
      valueDate,
      maturityDate,
      dateFrom,
      dateTo,
      dealType,
      format,
      page,
      pageSize,
      view
    } = req.query;

    const reportParams = {
      asAtDate,
      portfolio,
      isin,
      valueDate,
      maturityDate,
      dateFrom,
      dateTo,
      dealType,
      view
    };

    if (page && pageSize) {
      reportParams.page = Number(page);
      reportParams.pageSize = Number(pageSize);
    }

    const { data, total } = await repoReportService.getRepoReport(reportParams);

    if (format === 'csv' || format === 'excel' || format === 'pdf') {
      const fileBuffer = await reportExporter.exportRepo(format, data);
      const isTransactions = String(view || '').toLowerCase() === 'transactions'
        || String(view || '').toLowerCase() === 'transaction';
      const filename = isTransactions
        ? `repo_transactions_report.${format === 'excel' ? 'xlsx' : format}`
        : `repo_report.${format === 'excel' ? 'xlsx' : format}`;
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      res.setHeader('Content-Type', reportExporter.getMimeType(format));
      return res.send(fileBuffer);
    }

    const response = { data, total };
    if (page && pageSize) {
      response.page = Number(page);
      response.pageSize = Number(pageSize);
    }
    res.json(response);
  } catch (err) {
    console.error('Repo Report Error:', err);
    res.status(500).json({ error: 'Failed to generate Repo report', details: err.message });
  }
};

// GET /api/reports/tbill
exports.getTbillReport = async (req, res) => {
  try {
    const {
      asAtDate,
      portfolio,
      isin,
      valueDate,
      maturityDate,
      dateFrom,
      dateTo,
      format,
      page,
      pageSize,
      view
    } = req.query;

    const isTransactions = String(view || '').toLowerCase() === 'transactions'
      || String(view || '').toLowerCase() === 'transaction';

    if (isTransactions) {
      if (!dateFrom && !dateTo && !asAtDate && !valueDate && !isin) {
        return res.status(400).json({ error: 'A date range (From/To) or ISIN is required' });
      }
    } else if (!asAtDate && !isin) {
      return res.status(400).json({ error: 'Either asAtDate or ISIN is required' });
    }

    const reportParams = { asAtDate, portfolio, isin, valueDate, maturityDate, dateFrom, dateTo, view };
    if (page && pageSize) {
      reportParams.page = Number(page);
      reportParams.pageSize = Number(pageSize);
    }

    const { data, total, totalPortfolioBalance } = await tbillReportService.getTbillReport(reportParams);

    if (format === 'csv' || format === 'excel' || format === 'pdf') {
      const isTransactions = String(view || '').toLowerCase() === 'transactions'
        || String(view || '').toLowerCase() === 'transaction';
      const fileBuffer = isTransactions
        ? await reportExporter.exportTbillTransactions(format, data)
        : await reportExporter.exportTbill(format, data);
      const filename = isTransactions
        ? `tbill_transactions_report.${format === 'excel' ? 'xlsx' : format}`
        : `tbill_report.${format === 'excel' ? 'xlsx' : format}`;
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      res.setHeader('Content-Type', reportExporter.getMimeType(format));
      return res.send(fileBuffer);
    }

    const response = { data, total };
    if (page && pageSize) {
      response.page = Number(page);
      response.pageSize = Number(pageSize);
    }
    if (totalPortfolioBalance !== null) {
      response.totalPortfolioBalance = totalPortfolioBalance;
    }
    res.json(response);
  } catch (err) {
    console.error('T-Bill Report Error:', err);
    res.status(500).json({ error: 'Failed to generate T-Bill report', details: err.message });
  }
};

exports.getBrokerReport = async (req, res) => {
  try {
    const { startDate, endDate, broker } = req.query;
    const result = await brokerReportService.getBrokerReport({ startDate, endDate, broker });
    res.json(result);
  } catch (err) {
    console.error('Broker Report Error:', err);
    res.status(500).json({ error: 'Failed to generate Broker report', details: err.message });
  }
};

exports.getDailyPortfolioBalanceReport = async (req, res) => {
  try {
    const { asAtDate, format } = req.query;
    if (!asAtDate) {
      return res.status(400).json({ error: 'asAtDate is required' });
    }
    const result = await dailyPortfolioBalanceService.getDailyPortfolioBalance(asAtDate);

    if (format === 'csv' || format === 'excel' || format === 'pdf') {
      const custodianNames = result.custodianNames || [];
      const flatRows = (result.rows || []).map((row) => {
        const flat = {
          maturity_date: row.maturity_date,
          isin: row.isin,
          coupon_rate: row.coupon_rate,
          opening_balance: row.opening_balance,
          sell_buy: row.sell_buy,
          buy_sell: row.buy_sell,
          from: row.from,
          to: row.to,
          closing_balance: row.closing_balance,
          in_hand: row.in_hand
        };
        for (const name of custodianNames) {
          flat[name] = row.custodians?.[name] ?? 0;
        }
        return flat;
      });
      if (result.totals) {
        const totalRow = {
          maturity_date: 'Total',
          isin: '',
          coupon_rate: '',
          opening_balance: result.totals.opening_balance,
          sell_buy: '',
          buy_sell: '',
          from: result.totals.from,
          to: result.totals.to,
          closing_balance: result.totals.closing_balance,
          in_hand: result.totals.in_hand
        };
        for (const name of custodianNames) {
          totalRow[name] = result.totals.custodians?.[name] ?? 0;
        }
        flatRows.push(totalRow);
      }
      const fileBuffer = await reportExporter.export(format, flatRows);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=daily_portfolio_balance_report.${format === 'excel' ? 'xlsx' : format}`
      );
      res.setHeader('Content-Type', reportExporter.getMimeType(format));
      return res.send(fileBuffer);
    }

    res.json(result);
  } catch (err) {
    console.error('Daily Portfolio Balance Report Error:', err);
    res.status(500).json({ error: 'Failed to generate Daily Portfolio Balance report', details: err.message });
  }
};

exports.getDailyPortfolioBalanceBreakdown = async (req, res) => {
  try {
    const { asAtDate, isin, metric, custodian } = req.query;
    if (!asAtDate || !isin || !metric) {
      return res.status(400).json({ error: 'asAtDate, isin and metric are required' });
    }
    const result = await dailyPortfolioBalanceService.getDailyPortfolioBalanceBreakdown(
      asAtDate,
      isin,
      metric,
      custodian || null
    );
    res.json(result);
  } catch (err) {
    console.error('Daily Portfolio Balance Breakdown Error:', err);
    res.status(500).json({ error: 'Failed to fetch breakdown', details: err.message });
  }
};

// GET /api/reports/account-figures?asAtDate=YYYY-MM-DD
// Per-account "as per report" figures for reconciling Combined TB / GSec Balance
// Sheet nets against this system's product reports (GSec, T-Bill, Buy/Sell
// buyback, Repo / Reverse Repo) as at the given date.
exports.getAccountReportFigures = async (req, res) => {
  try {
    const { asAtDate } = req.query;
    if (!asAtDate) {
      return res.status(400).json({ error: 'asAtDate is required' });
    }

    const { figures } = await accountReportFiguresService.getAccountReportFigures(asAtDate);
    res.json({ success: true, asAtDate, figures });
  } catch (err) {
    console.error('Account Report Figures Error:', err);
    res.status(500).json({ error: 'Failed to compute account report figures', details: err.message });
  }
};
