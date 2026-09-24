const gsecReportService = require('./gsecReportService');
const tbillReportService = require('./tbillReportService');
const { getRepoCollateralByIsin } = require('./repoCollateralService');

/**
 * "As at date" outstanding views for the Portfolio Report.
 *
 * Both views are composed from the existing GSec and T-Bill report engines
 * rather than re-deriving holdings, so the numbers here can never drift from
 * the GSec / T-Bill reports the desk already reconciles against. Those engines
 * apply the as-at rules (value_date <= as-at, maturity_date > as-at) and the
 * sell / buyback deductions that make a balance "outstanding".
 */

// Report engines hand back display strings ("1,234,567.89"); parse before summing.
function num(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function fmtAmount(value) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function ymd(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** Outstanding GSec bond and T-Bill holdings, normalised to one row shape. */
async function loadHoldings({ asAtDate, portfolio, isin }) {
  const [gsecRes, tbillRes] = await Promise.all([
    gsecReportService.getGsecReport({ asAtDate, portfolio, isin }),
    tbillReportService.getTbillReport({ asAtDate, portfolio, isin })
  ]);

  // GSec: face_value is the outstanding face (stored remaining, else sell/buyback derived).
  const gsec = (gsecRes?.data || []).map((r) => ({
    product_type: 'GSec',
    portfolio: r.portfolio || '',
    deal_number: r.deal_number || '',
    isin: r.isin || '',
    value_date: r.value_date,
    maturity_date: r.maturity_date,
    coupon: r.coupon_rate || '',
    p_yield: r.yield || '',
    c_price: r.clean_price || '',
    dtm: r.dtm || '',
    balance_num: num(r.face_value)
  }));

  // T-Bill: no coupon; C.Price is the price per 100, P.Yield the discount rate.
  const tbill = (tbillRes?.data || []).map((r) => ({
    product_type: 'T-Bill',
    portfolio: r.portfolio || '',
    deal_number: r.deal_number || '',
    isin: r.isin_number || '',
    value_date: r.value_date,
    maturity_date: r.maturity_date,
    coupon: '',
    p_yield: r.discount_rate_pct || '',
    c_price: r.price_per_100 || '',
    dtm: r.days_to_maturity || '',
    balance_num: num(r.face_value)
  }));

  return { gsec, tbill };
}

// Shorter maturity first, then ISIN, then value date - matches the GSec report's
// existing ISIN summary ordering.
function sortHoldings(rows) {
  return rows.slice().sort((a, b) => {
    const ma = ymd(a.maturity_date);
    const mb = ymd(b.maturity_date);
    if (ma && mb && ma !== mb) return ma.localeCompare(mb);
    if (ma && !mb) return -1;
    if (!ma && mb) return 1;
    if (a.isin !== b.isin) return String(a.isin).localeCompare(String(b.isin));
    return ymd(a.value_date).localeCompare(ymd(b.value_date));
  });
}

/**
 * Outstanding view - deal-level rows for GSec bonds and T-Bills together.
 */
exports.getPortfolioOutstanding = async ({ asAtDate, portfolio, isin, page, pageSize }) => {
  const { gsec, tbill } = await loadHoldings({ asAtDate, portfolio, isin });
  const all = [...sortHoldings(gsec), ...sortHoldings(tbill)];

  const totalBalance = all.reduce((sum, r) => sum + r.balance_num, 0);
  const total = all.length;

  let rows = all;
  if (page && pageSize) {
    const offset = (Number(page) - 1) * Number(pageSize);
    rows = all.slice(offset, offset + Number(pageSize));
  }

  const data = rows.map((r) => ({
    product_type: r.product_type,
    portfolio: r.portfolio,
    deal_number: r.deal_number,
    isin: r.isin,
    value_date: r.value_date,
    maturity_date: r.maturity_date,
    // Key names chosen to match ReportTable's formatter: coupon_rate renders as
    // a percentage, yield and clean_price to 4 decimals, balance_amt as money.
    coupon_rate: r.coupon,
    yield: r.p_yield,
    clean_price: r.c_price,
    dtm: r.dtm,
    balance_amt: fmtAmount(r.balance_num)
  }));

  return {
    data,
    total,
    totals: { balance_amt: fmtAmount(totalBalance) }
  };
};

/**
 * Summary view - holdings grouped by ISIN with a Sub Total per ISIN, GSec bonds
 * and T-Bills in their own sections, and Repo Quar (face pledged as repo
 * collateral) reported at ISIN level, which is the level it is held at.
 */
exports.getPortfolioSummary = async ({ asAtDate, portfolio, isin }) => {
  const { gsec, tbill } = await loadHoldings({ asAtDate, portfolio, isin });

  const allIsins = [...gsec, ...tbill].map((r) => r.isin).filter(Boolean);
  const repoByIsin = await getRepoCollateralByIsin(allIsins, asAtDate);

  const rows = [];
  let grandBalance = 0;
  let grandRepo = 0;

  const buildSection = (label, holdings) => {
    if (!holdings.length) return;

    rows.push({ _type: 'section', _rowClass: 'bg-gray-100 font-semibold', isin: label });

    // Group by ISIN, keeping the sorted order of first appearance.
    const groups = new Map();
    sortHoldings(holdings).forEach((r) => {
      if (!groups.has(r.isin)) groups.set(r.isin, []);
      groups.get(r.isin).push(r);
    });

    let sectionBalance = 0;
    let sectionRepo = 0;

    groups.forEach((deals, isinKey) => {
      deals.forEach((r) => {
        rows.push({
          _type: 'deal',
          isin: r.isin,
          yield: r.p_yield,
          value_date: r.value_date,
          maturity_date: r.maturity_date,
          coupon_rate: r.coupon,
          clean_price: r.c_price,
          dtm: r.dtm,
          balance_amt: fmtAmount(r.balance_num),
          sub_total: '',
          repo_quar: ''
        });
      });

      const isinBalance = deals.reduce((sum, r) => sum + r.balance_num, 0);
      // Repo collateral is held against the ISIN, not the individual deal, so it
      // belongs on the subtotal line - putting it on each deal row would
      // multiply it by the number of lots.
      const isinRepo = Number(repoByIsin[isinKey] || 0);

      rows.push({
        _type: 'subtotal',
        _rowClass: 'bg-blue-50 font-semibold',
        isin: `${isinKey} - Sub Total`,
        yield: '',
        value_date: '',
        maturity_date: '',
        coupon_rate: '',
        clean_price: '',
        dtm: '',
        balance_amt: '',
        sub_total: fmtAmount(isinBalance),
        repo_quar: fmtAmount(isinRepo)
      });

      sectionBalance += isinBalance;
      sectionRepo += isinRepo;
    });

    rows.push({
      _type: 'total',
      _rowClass: 'bg-gray-200 font-bold',
      isin: `${label} Total`,
      sub_total: fmtAmount(sectionBalance),
      repo_quar: fmtAmount(sectionRepo)
    });

    grandBalance += sectionBalance;
    grandRepo += sectionRepo;
  };

  buildSection('GSec Bonds', gsec);
  buildSection('T-Bills', tbill);

  return {
    data: rows,
    total: rows.length,
    totals: {
      isin: 'Grand Total',
      sub_total: fmtAmount(grandBalance),
      repo_quar: fmtAmount(grandRepo)
    }
  };
};
