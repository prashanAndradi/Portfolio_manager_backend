const db = require('../db');

/**
 * Face value locked as repo collateral, keyed by ISIN ("Repo Quar" on the
 * portfolio summary). Works for any ISIN - GSec or T-Bill - because repo
 * collateral is recorded against the ISIN number itself.
 *
 * The filter rules mirror gsecReportService's inline repo_collateral block so
 * the two reports cannot disagree. Only deduct collateral for repo /
 * reverse-repo deals that are:
 *   (a) still Active/Pending, AND
 *   (b) not flagged matured (the maturity flow sets matured=1 but does NOT
 *       change `status`, so a status-only filter leaks matured deals), AND
 *   (c) whose maturity_date is still in the future relative to the as-at date
 *       (safety net for deals whose maturity processing was missed), AND
 *   (d) not rejected in the approval workflow - rejecting only updates
 *       `approval_status`, never the lifecycle `status` column, so a rejected
 *       deal would otherwise keep locking collateral it never held.
 */
async function getRepoCollateralByIsin(isins, asAtDate) {
  const unique = [...new Set((isins || []).filter(Boolean))];
  const byIsin = {};
  if (!unique.length) return byIsin;

  const effectiveAsAt = asAtDate || new Date().toISOString().split('T')[0];
  const ph = unique.map(() => '?').join(',');

  // Multi-ISIN repo deals record their legs in repo_deal_isins.
  const [childRows] = await db.query(
    `SELECT rdi.isin_number, COALESCE(SUM(rdi.face_value), 0) AS rc
       FROM repo_deal_isins rdi
       JOIN repo_deals rd ON rd.id = rdi.repo_deal_id
      WHERE rdi.isin_number IN (${ph})
        AND rd.status IN ('Active','Pending')
        AND COALESCE(rd.approval_status, '') <> 'rejected'
        AND COALESCE(rd.matured, 0) = 0
        AND (rd.maturity_date IS NULL OR DATE(rd.maturity_date) > DATE(?))
      GROUP BY rdi.isin_number`,
    [...unique, effectiveAsAt]
  );
  childRows.forEach((r) => {
    byIsin[r.isin_number] = Number(r.rc) || 0;
  });

  // Legacy single-ISIN repo deals with no child rows.
  const [legacyRows] = await db.query(
    `SELECT rd.isin_number, COALESCE(SUM(rd.face_value), 0) AS rc
       FROM repo_deals rd
       LEFT JOIN repo_deal_isins rdi ON rdi.repo_deal_id = rd.id
      WHERE rdi.id IS NULL
        AND rd.isin_number IN (${ph})
        AND rd.status IN ('Active','Pending')
        AND COALESCE(rd.approval_status, '') <> 'rejected'
        AND COALESCE(rd.matured, 0) = 0
        AND (rd.maturity_date IS NULL OR DATE(rd.maturity_date) > DATE(?))
      GROUP BY rd.isin_number`,
    [...unique, effectiveAsAt]
  );
  legacyRows.forEach((r) => {
    byIsin[r.isin_number] = (byIsin[r.isin_number] || 0) + (Number(r.rc) || 0);
  });

  return byIsin;
}

module.exports = { getRepoCollateralByIsin };
