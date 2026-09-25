const db = require('../config/database');

function ymd(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Maturity and issue date are properties of the ISIN, not of the deal, but the
 * gsec row keeps its own copy captured at entry time. Nothing used to check the
 * two agreed, so a deal could be saved carrying another bond's dates - see
 * 20260715/GSEC/0015, which was booked on LKB00326L151 while holding
 * LKB00628A153's issue (2022-01-15) and maturity (2028-01-15). That misprices
 * the deal and makes one ISIN show two maturities on the portfolio report.
 *
 * Returns { ok: true } when the dates agree with isin_master (or when there is
 * nothing to compare against - unknown ISIN, or dates not supplied).
 */
async function validateDealDatesAgainstIsinMaster({ isin, maturityDate, issueDate }) {
  const isinNumber = String(isin || '').trim();
  if (!isinNumber) return { ok: true };

  const [rows] = await db.query(
    'SELECT isin_number, maturity_date, issue_date FROM isin_master WHERE isin_number = ? LIMIT 1',
    [isinNumber]
  );
  const master = rows && rows[0];
  // Unknown ISIN is a separate concern (and some flows pre-date the master), so
  // do not block the save here.
  if (!master) return { ok: true };

  const mismatches = [];
  const dealMaturity = ymd(maturityDate);
  const masterMaturity = ymd(master.maturity_date);
  if (dealMaturity && masterMaturity && dealMaturity !== masterMaturity) {
    mismatches.push(`maturity date is ${dealMaturity} but ISIN ${isinNumber} matures ${masterMaturity}`);
  }

  const dealIssue = ymd(issueDate);
  const masterIssue = ymd(master.issue_date);
  if (dealIssue && masterIssue && dealIssue !== masterIssue) {
    mismatches.push(`issue date is ${dealIssue} but ISIN ${isinNumber} was issued ${masterIssue}`);
  }

  if (!mismatches.length) return { ok: true };

  return {
    ok: false,
    message:
      `Deal dates do not match the ISIN master: ${mismatches.join('; ')}. ` +
      'This usually means the ISIN was changed after the dates were filled in. ' +
      'Re-select the ISIN so the issue date, maturity date and coupon schedule refresh, then save again.',
    expected: { maturity_date: masterMaturity, issue_date: masterIssue }
  };
}

module.exports = { validateDealDatesAgainstIsinMaster };
