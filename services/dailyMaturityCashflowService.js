/**
 * Daily Maturity Cashflow — products maturing / settling on a selected date.
 *
 * For every selected date D (past, current, or future):
 *   - maturities on D only
 *
 * Buyback maturity uses leg2_value_date. New-deal / value-date settlements
 * are not listed on Maturity Handling.
 */
const db = require('../config/database');
const Gsec = require('../models/gsec');
const { getSystemDay } = require('../models/systemDayModel');

const BANK_KEYS = ['cbsl', 'fmc', 'nsb', 'boc'];

function toYmd(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

/**
 * @returns {'past'|'current'|'future'}
 */
function resolveViewMode(selectedYmd, systemYmd) {
  if (!selectedYmd || !systemYmd) return 'current';
  if (selectedYmd < systemYmd) return 'past';
  if (selectedYmd > systemYmd) return 'future';
  return 'current';
}

function emptyBankAmounts() {
  return { cbsl: 0, fmc: 0, nsb: 0, boc: 0 };
}

function dayBefore(ymd) {
  const dt = new Date(`${ymd}T12:00:00`);
  dt.setDate(dt.getDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function resolveBankColumn(settlementMode, settlementByCode) {
  const key = String(settlementMode || '').trim();
  const sa = settlementByCode.get(key) || settlementByCode.get(key.toUpperCase());
  const name = `${sa?.bank_name || ''} ${sa?.bank_payment_code || ''} ${key}`.toLowerCase();
  if (name.includes('cbsl') || name.includes('central bank')) return 'cbsl';
  if (name.includes('fmc') || name.includes('first capital')) return 'fmc';
  if (name.includes('nsb') || name.includes('national savings')) return 'nsb';
  if (name.includes('boc') || name.includes('ceylon')) return 'boc';
  return 'boc';
}

function withBankAmount(settlementMode, amount, settlementByCode) {
  const banks = emptyBankAmounts();
  const col = resolveBankColumn(settlementMode, settlementByCode);
  banks[col] = amount;
  return banks;
}

function signedAmount(cashFlow, amount) {
  const n = Math.abs(Number(amount) || 0);
  return cashFlow === 'Less' ? -n : n;
}

function withSettlementValue(row) {
  row.settlement_value = signedAmount(row.cash_flow, row.maturity_amount);
  return row;
}

/** Cashflow blotter lists all settlements on the date, including EOD-posted maturities. */
function computeSelectable({ matured, approved, approvalLevel }) {
  if (matured) return false;
  if (!approved) return false;
  if (
    approvalLevel &&
    approvalLevel !== 'not_initiated' &&
    approvalLevel !== 'back_office_final'
  ) {
    return false;
  }
  return true;
}

const MPL_JOIN_MM = `
    LEFT JOIN maturity_processing_log mpl ON mmd.id = mpl.deal_id
      AND mpl.deal_number COLLATE utf8mb4_unicode_ci = mmd.deal_number COLLATE utf8mb4_unicode_ci
      AND mpl.id = (
        SELECT id FROM maturity_processing_log mpl2
        WHERE mpl2.deal_id = mmd.id
          AND mpl2.deal_number COLLATE utf8mb4_unicode_ci = mmd.deal_number COLLATE utf8mb4_unicode_ci
        ORDER BY mpl2.created_at DESC
        LIMIT 1
      )`;

const MPL_JOIN_GSEC = `
    LEFT JOIN maturity_processing_log mpl ON g.id = mpl.deal_id
      AND mpl.deal_number COLLATE utf8mb4_unicode_ci = g.deal_number COLLATE utf8mb4_unicode_ci
      AND mpl.id = (
        SELECT id FROM maturity_processing_log mpl2
        WHERE mpl2.deal_id = g.id
          AND mpl2.deal_number COLLATE utf8mb4_unicode_ci = g.deal_number COLLATE utf8mb4_unicode_ci
        ORDER BY mpl2.created_at DESC
        LIMIT 1
      )`;

const MPL_JOIN_REPO = `
    LEFT JOIN maturity_processing_log mpl ON rd.id = mpl.deal_id
      AND mpl.deal_number COLLATE utf8mb4_unicode_ci = rd.deal_number COLLATE utf8mb4_unicode_ci
      AND mpl.id = (
        SELECT id FROM maturity_processing_log mpl2
        WHERE mpl2.deal_id = rd.id
          AND mpl2.deal_number COLLATE utf8mb4_unicode_ci = rd.deal_number COLLATE utf8mb4_unicode_ci
        ORDER BY mpl2.created_at DESC
        LIMIT 1
      )`;

const MPL_JOIN_BB = `
    LEFT JOIN maturity_processing_log mpl ON bb.id = mpl.deal_id
      AND mpl.deal_number COLLATE utf8mb4_unicode_ci = bb.deal_number COLLATE utf8mb4_unicode_ci
      AND mpl.id = (
        SELECT id FROM maturity_processing_log mpl2
        WHERE mpl2.deal_id = bb.id
          AND mpl2.deal_number COLLATE utf8mb4_unicode_ci = bb.deal_number COLLATE utf8mb4_unicode_ci
        ORDER BY mpl2.created_at DESC
        LIMIT 1
      )`;

async function loadSettlementAccounts() {
  const [rows] = await db.query(
    'SELECT bank_name, bank_payment_code FROM settlement_accounts'
  );
  const map = new Map();
  for (const row of rows || []) {
    if (row.bank_payment_code) {
      map.set(String(row.bank_payment_code), row);
      map.set(String(row.bank_payment_code).toUpperCase(), row);
    }
  }
  return map;
}

async function attachOpeningBalances(rows, asOfDate) {
  const balanceCache = new Map();
  const dayBeforeDate = dayBefore(asOfDate);
  for (const row of rows) {
    if (!row.isin) {
      row.opening_balance = null;
      continue;
    }
    const portfolio = row.portfolio || '';
    const cacheKey = `${row.isin}|${portfolio}|${dayBeforeDate}`;
    if (!balanceCache.has(cacheKey)) {
      try {
        balanceCache.set(
          cacheKey,
          await Gsec.getOpeningBalance(row.isin, portfolio, dayBeforeDate)
        );
      } catch {
        balanceCache.set(cacheKey, null);
      }
    }
    row.opening_balance = balanceCache.get(cacheKey);
  }
  return rows;
}

function buildTotals(rows) {
  const banks = emptyBankAmounts();
  let netCashflow = 0;
  for (const row of rows) {
    const signed = signedAmount(row.cash_flow, row.maturity_amount);
    netCashflow += signed;
    for (const key of BANK_KEYS) {
      const bankAmt = Number(row.banks?.[key] || 0);
      if (!bankAmt) continue;
      banks[key] += row.cash_flow === 'Less' ? -bankAmt : bankAmt;
    }
  }
  return { banks, net_cashflow: netCashflow };
}

async function queryMoneyMarket(dateStr, settlementByCode) {
  const [rows] = await db.query(
    `
    SELECT
      mmd.id,
      mmd.deal_number,
      mmd.product_type,
      mmd.settlement_mode,
      mmd.principal_amount,
      mmd.interest_amount,
      mmd.maturity_value,
      mmd.maturity_date,
      mmd.status AS deal_status,
      COALESCE(mmd.matured, 0) AS matured,
      COALESCE(corp.short_name, ind.short_name, joint.short_name, mmd.counterparty_id) AS counterparty_name,
      COALESCE(mpl.authorization_level, 'not_initiated') AS approval_level,
      CASE
        WHEN mpl.authorization_level = 'back_office_final' THEN 'Back Office Final'
        WHEN COALESCE(mmd.matured, 0) = 1 THEN 'Matured (EOD)'
        ELSE 'Pending Final Approval'
      END AS approval_level_display
    FROM money_market_deals mmd
    LEFT JOIN counterparty_master_corporate corp ON mmd.counterparty_id = corp.id
    LEFT JOIN counterparty_master_individual ind ON mmd.counterparty_id = ind.id
    LEFT JOIN counterparty_master_joint joint ON mmd.counterparty_id = joint.id
    ${MPL_JOIN_MM}
    WHERE DATE(mmd.maturity_date) = ?
      AND mmd.status = 'Approved'
    ORDER BY mmd.deal_number
    `,
    [dateStr]
  );

  return (rows || []).map((row, idx) => {
    const maturityAmount = parseFloat(row.maturity_value || 0);
    const banks = withBankAmount(row.settlement_mode, maturityAmount, settlementByCode);
    const cp = row.counterparty_name || '';
    return {
      id: row.id || `mm-${idx}`,
      deal_number: row.deal_number,
      deal_type: 'money_market',
      event_type: 'maturity',
      instrument: 'Money Market',
      cash_flow: 'Add',
      description: `Maturity of ${row.product_type || 'Money Market'} - ${cp}`,
      reference_deal_number: null,
      isin: '',
      portfolio: null,
      counterparty: cp,
      face_value: parseFloat(row.principal_amount || 0),
      interest_amount: parseFloat(row.interest_amount || 0),
      maturity_amount: maturityAmount,
      maturity_date: row.maturity_date,
      value_date: row.maturity_date,
      days_to_maturity: 0,
      val_mat: 'On Maturity Date',
      settlement_mode: row.settlement_mode,
      banks,
      status: row.deal_status || 'pending',
      approval_level: row.approval_level,
      approval_level_display: row.approval_level_display,
      is_selectable: computeSelectable({
        matured: Number(row.matured) === 1,
        approved: row.deal_status === 'Approved',
        approvalLevel: row.approval_level
      })
    };
  });
}

async function queryGsec(dateStr, settlementByCode) {
  const [rows] = await db.query(
    `
    SELECT
      g.id,
      g.deal_number,
      g.isin_number AS isin,
      g.portfolio,
      g.settlement_mode,
      g.face_value,
      g.accrued_interest,
      g.settlement_amount,
      g.maturity_date,
      g.value_date,
      g.transaction_type,
      g.buy_deal_number,
      g.status AS deal_status,
      COALESCE(g.matured, 0) AS matured,
      COALESCE(corp.short_name, ind.short_name, joint.short_name, g.counterparty_id) AS counterparty_name,
      COALESCE(mpl.authorization_level, 'not_initiated') AS approval_level,
      CASE
        WHEN mpl.authorization_level = 'back_office_final' THEN 'Back Office Final'
        WHEN COALESCE(g.matured, 0) = 1 THEN 'Matured (EOD)'
        ELSE 'Pending Final Approval'
      END AS approval_level_display
    FROM gsec g
    LEFT JOIN counterparty_master_corporate corp ON
      (g.counterparty_id LIKE 'c%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = corp.id)
      OR (g.counterparty_id = corp.id)
    LEFT JOIN counterparty_master_individual ind ON
      (g.counterparty_id LIKE 'i%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = ind.id)
      OR (g.counterparty_id = ind.id)
    LEFT JOIN counterparty_master_joint joint ON
      (g.counterparty_id LIKE 'j%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = joint.id)
      OR (g.counterparty_id = joint.id)
    ${MPL_JOIN_GSEC}
    WHERE DATE(g.maturity_date) = ?
      AND g.status = 'final_approved'
      AND g.transaction_type = 'Buy'
      AND g.buyback_deal_id IS NULL
    ORDER BY g.deal_number
    `,
    [dateStr]
  );

  return (rows || []).map((row, idx) => {
    const maturityAmount = parseFloat(row.settlement_amount || 0);
    const banks = withBankAmount(row.settlement_mode, maturityAmount, settlementByCode);
    const cp = row.counterparty_name || '';
    return {
      id: row.id || `gsec-${idx}`,
      deal_number: row.deal_number,
      deal_type: 'gsec',
      event_type: 'maturity',
      instrument: 'GSEC',
      cash_flow: 'Add',
      description: `Maturity of T.Bond - ${cp}`,
      reference_deal_number: row.buy_deal_number || null,
      isin: row.isin,
      portfolio: row.portfolio,
      counterparty: cp,
      face_value: parseFloat(row.face_value || 0),
      interest_amount: parseFloat(row.accrued_interest || 0),
      maturity_amount: maturityAmount,
      maturity_date: row.maturity_date,
      value_date: row.value_date,
      days_to_maturity: 0,
      val_mat: 'On Maturity Date',
      settlement_mode: row.settlement_mode,
      banks,
      status: row.deal_status || 'pending',
      approval_level: row.approval_level,
      approval_level_display: row.approval_level_display,
      is_selectable: computeSelectable({
        matured: Number(row.matured) === 1,
        approved: row.deal_status === 'final_approved',
        approvalLevel: row.approval_level
      })
    };
  });
}

async function queryRepo(dateStr, settlementByCode) {
  const [rows] = await db.query(
    `
    SELECT
      rd.id,
      rd.deal_number,
      rd.deal_type,
      rd.isin_number AS isin,
      rd.settlement_mode,
      rd.principal_amount,
      rd.interest_amount,
      rd.maturity_amount,
      rd.maturity_date,
      rd.value_date,
      rd.status AS deal_status,
      COALESCE(rd.matured, 0) AS matured,
      COALESCE(corp.short_name, ind.short_name, joint.short_name, rd.counterparty_id) AS counterparty_name,
      COALESCE(mpl.authorization_level, 'not_initiated') AS approval_level,
      CASE
        WHEN mpl.authorization_level = 'back_office_final' THEN 'Back Office Final'
        WHEN COALESCE(rd.matured, 0) = 1 THEN 'Matured (EOD)'
        ELSE 'Pending Final Approval'
      END AS approval_level_display
    FROM repo_deals rd
    LEFT JOIN counterparty_master_corporate corp ON rd.counterparty_id = corp.id
    LEFT JOIN counterparty_master_individual ind ON rd.counterparty_id = ind.id
    LEFT JOIN counterparty_master_joint joint ON rd.counterparty_id = joint.id
    ${MPL_JOIN_REPO}
    WHERE DATE(rd.maturity_date) = ?
      AND rd.approval_status = 'final_approved'
    ORDER BY rd.deal_number
    `,
    [dateStr]
  );

  return (rows || []).map((row, idx) => {
    const maturityAmount = parseFloat(row.maturity_amount || 0);
    const banks = withBankAmount(row.settlement_mode, maturityAmount, settlementByCode);
    const cp = row.counterparty_name || '';
    // Reverse Repo = Sherwood lent, cash comes back at maturity (Add);
    // Repo = Sherwood borrowed, cash paid out at maturity (Less).
    const isReverse = String(row.deal_type || '').toLowerCase().includes('reverse');
    const cashFlow = isReverse ? 'Add' : 'Less';
    return {
      id: row.id || `repo-${idx}`,
      deal_number: row.deal_number,
      deal_type: 'repo',
      event_type: 'maturity',
      instrument: isReverse ? 'Reverse Repo' : 'Repo',
      cash_flow: cashFlow,
      description: isReverse
        ? `Settlement of Reverse Repo - ${cp}`
        : `Settlement of Repo - ${cp}`,
      reference_deal_number: null,
      isin: row.isin || '',
      portfolio: null,
      counterparty: cp,
      face_value: parseFloat(row.principal_amount || 0),
      interest_amount: parseFloat(row.interest_amount || 0),
      maturity_amount: maturityAmount,
      maturity_date: row.maturity_date,
      value_date: row.value_date,
      days_to_maturity: 0,
      val_mat: 'On Maturity Date',
      settlement_mode: row.settlement_mode,
      banks,
      status: row.deal_status || 'pending',
      approval_level: row.approval_level,
      approval_level_display: row.approval_level_display,
      is_selectable: computeSelectable({
        matured: Number(row.matured) === 1,
        approved: true,
        approvalLevel: row.approval_level
      })
    };
  });
}

async function queryBuyback(dateStr, settlementByCode) {
  const [rows] = await db.query(
    `
    SELECT
      bb.id,
      bb.deal_number,
      bb.leg1_isin AS isin,
      bb.leg1_portfolio AS portfolio,
      bb.leg1_transaction_type,
      bb.leg2_transaction_type,
      bb.leg2_settlement_mode,
      bb.leg2_settlement_amount,
      bb.leg2_value_date,
      bb.leg2_accrued_interest,
      bb.source_buy_deal_number,
      COALESCE(bb.leg1_adjusted_face_value, bb.leg1_face_value) AS face_value,
      bb.deal_status,
      COALESCE(corp.short_name, ind.short_name, joint.short_name, CONCAT('ID:', bb.leg1_counterparty)) AS counterparty_name,
      COALESCE(mpl.authorization_level, 'not_initiated') AS approval_level,
      CASE
        WHEN mpl.authorization_level = 'back_office_final' THEN 'Back Office Final'
        ELSE 'Pending Final Approval'
      END AS approval_level_display
    FROM buyback_deals bb
    LEFT JOIN counterparty_master_corporate corp ON
      (bb.leg1_counterparty LIKE 'c%' AND CAST(SUBSTRING(bb.leg1_counterparty, 2) AS UNSIGNED) = corp.id)
      OR (bb.leg1_counterparty = corp.id)
    LEFT JOIN counterparty_master_individual ind ON
      (bb.leg1_counterparty LIKE 'i%' AND CAST(SUBSTRING(bb.leg1_counterparty, 2) AS UNSIGNED) = ind.id)
      OR (bb.leg1_counterparty = ind.id)
    LEFT JOIN counterparty_master_joint joint ON
      (bb.leg1_counterparty LIKE 'j%' AND CAST(SUBSTRING(bb.leg1_counterparty, 2) AS UNSIGNED) = joint.id)
      OR (bb.leg1_counterparty = joint.id)
    ${MPL_JOIN_BB}
    WHERE DATE(bb.leg2_value_date) = ?
      AND bb.deal_status = 'Approved'
      AND bb.approved_at IS NOT NULL
    ORDER BY bb.deal_number
    `,
    [dateStr]
  );

  return (rows || []).map((row, idx) => {
    const maturityAmount = parseFloat(row.leg2_settlement_amount || 0);
    const banks = withBankAmount(row.leg2_settlement_mode, maturityAmount, settlementByCode);
    const cp = row.counterparty_name || '';
    const leg1 = String(row.leg1_transaction_type || '').toLowerCase();
    const leg2 = String(row.leg2_transaction_type || '').toLowerCase();
    const isSellBuy = leg1 === 'sell' && leg2 === 'buy';
    const instrument = isSellBuy ? 'Sell-Buy' : 'Buy-Sell';
    const cashFlow = leg2 === 'sell' ? 'Add' : 'Less';
    const description = leg2 === 'sell'
      ? `Sale of T.Bond - ${cp}`
      : `Settlement of Sell-Buy - ${cp}`;

    return {
      id: row.id || `bb-${idx}`,
      deal_number: row.deal_number,
      deal_type: 'buyback',
      event_type: 'maturity',
      instrument,
      cash_flow: cashFlow,
      description,
      reference_deal_number: row.source_buy_deal_number || null,
      isin: row.isin,
      portfolio: row.portfolio,
      counterparty: cp,
      face_value: parseFloat(row.face_value || 0),
      interest_amount: parseFloat(row.leg2_accrued_interest || 0),
      maturity_amount: maturityAmount,
      maturity_date: row.leg2_value_date,
      value_date: row.leg2_value_date,
      days_to_maturity: 0,
      val_mat: 'On Maturity Date',
      settlement_mode: row.leg2_settlement_mode,
      banks,
      status: row.deal_status || 'pending',
      approval_level: row.approval_level,
      approval_level_display: row.approval_level_display,
      is_selectable: computeSelectable({
        matured: false,
        approved: row.deal_status === 'Approved',
        approvalLevel: row.approval_level
      })
    };
  });
}

async function queryMoneyMarketSettlements(dateStr, settlementByCode) {
  // Placements settling on value date (cash out).
  const [rows] = await db.query(
    `
    SELECT
      mmd.id,
      mmd.deal_number,
      mmd.product_type,
      mmd.settlement_mode,
      mmd.principal_amount,
      mmd.interest_amount,
      mmd.maturity_value,
      mmd.maturity_date,
      mmd.value_date,
      mmd.status AS deal_status,
      COALESCE(corp.short_name, ind.short_name, joint.short_name, mmd.counterparty_id) AS counterparty_name
    FROM money_market_deals mmd
    LEFT JOIN counterparty_master_corporate corp ON mmd.counterparty_id = corp.id
    LEFT JOIN counterparty_master_individual ind ON mmd.counterparty_id = ind.id
    LEFT JOIN counterparty_master_joint joint ON mmd.counterparty_id = joint.id
    WHERE DATE(mmd.value_date) = ?
      AND LOWER(COALESCE(mmd.status, '')) NOT IN ('cancelled', 'rejected')
    ORDER BY mmd.deal_number
    `,
    [dateStr]
  );

  return (rows || []).map((row, idx) => {
    const amount = parseFloat(row.principal_amount || 0);
    const banks = withBankAmount(row.settlement_mode, amount, settlementByCode);
    const cp = row.counterparty_name || '';
    return {
      id: row.id || `mm-set-${idx}`,
      deal_number: row.deal_number,
      deal_type: 'money_market',
      event_type: 'settlement',
      instrument: 'Money Market',
      cash_flow: 'Less',
      description: `Placement of ${row.product_type || 'Money Market'} - ${cp}`,
      reference_deal_number: null,
      isin: '',
      portfolio: null,
      counterparty: cp,
      face_value: amount,
      interest_amount: parseFloat(row.interest_amount || 0),
      maturity_amount: amount,
      maturity_date: row.maturity_date,
      value_date: row.value_date,
      days_to_maturity: 0,
      val_mat: 'On Value Date',
      settlement_mode: row.settlement_mode,
      banks,
      status: row.deal_status || 'Approved',
      approval_level: 'not_initiated',
      approval_level_display: 'Settled',
      is_selectable: false
    };
  });
}

async function queryGsecSettlements(dateStr, settlementByCode) {
  const [rows] = await db.query(
    `
    SELECT
      g.id,
      g.deal_number,
      g.isin_number AS isin,
      g.portfolio,
      g.settlement_mode,
      g.face_value,
      g.accrued_interest,
      g.settlement_amount,
      g.maturity_date,
      g.value_date,
      g.transaction_type,
      g.buy_deal_number,
      g.buyback_deal_id,
      g.status AS deal_status,
      COALESCE(corp.short_name, ind.short_name, joint.short_name, g.counterparty_id) AS counterparty_name
    FROM gsec g
    LEFT JOIN counterparty_master_corporate corp ON
      (g.counterparty_id LIKE 'c%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = corp.id)
      OR (g.counterparty_id = corp.id)
    LEFT JOIN counterparty_master_individual ind ON
      (g.counterparty_id LIKE 'i%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = ind.id)
      OR (g.counterparty_id = ind.id)
    LEFT JOIN counterparty_master_joint joint ON
      (g.counterparty_id LIKE 'j%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = joint.id)
      OR (g.counterparty_id = joint.id)
    WHERE DATE(g.value_date) = ?
      AND LOWER(COALESCE(g.status, '')) NOT IN ('cancelled', 'rejected')
    ORDER BY g.deal_number
    `,
    [dateStr]
  );

  return (rows || []).map((row, idx) => {
    const amount = parseFloat(row.settlement_amount || 0);
    const banks = withBankAmount(row.settlement_mode, amount, settlementByCode);
    const cp = row.counterparty_name || '';
    const isSell = String(row.transaction_type || '').toLowerCase() === 'sell';
    return {
      id: row.id || `gsec-set-${idx}`,
      deal_number: row.deal_number,
      deal_type: 'gsec',
      event_type: 'settlement',
      instrument: 'GSEC',
      cash_flow: isSell ? 'Add' : 'Less',
      description: isSell ? `Sale of T.Bond - ${cp}` : `Purchase of T.Bond - ${cp}`,
      reference_deal_number: row.buy_deal_number || null,
      isin: row.isin,
      portfolio: row.portfolio,
      counterparty: cp,
      face_value: parseFloat(row.face_value || 0),
      interest_amount: parseFloat(row.accrued_interest || 0),
      maturity_amount: amount,
      maturity_date: row.maturity_date,
      value_date: row.value_date,
      days_to_maturity: 0,
      val_mat: 'On Value Date',
      settlement_mode: row.settlement_mode,
      banks,
      status: row.deal_status || 'final_approved',
      approval_level: 'not_initiated',
      approval_level_display: 'Settled',
      is_selectable: false
    };
  });
}

async function queryRepoSettlements(dateStr, settlementByCode) {
  // Start-leg cash on value date. Opposite of maturity cash direction.
  const [rows] = await db.query(
    `
    SELECT
      rd.id,
      rd.deal_number,
      rd.deal_type,
      rd.isin_number AS isin,
      rd.settlement_mode,
      rd.principal_amount,
      rd.interest_amount,
      rd.maturity_amount,
      rd.maturity_date,
      rd.value_date,
      rd.status AS deal_status,
      COALESCE(corp.short_name, ind.short_name, joint.short_name, rd.counterparty_id) AS counterparty_name
    FROM repo_deals rd
    LEFT JOIN counterparty_master_corporate corp ON rd.counterparty_id = corp.id
    LEFT JOIN counterparty_master_individual ind ON rd.counterparty_id = ind.id
    LEFT JOIN counterparty_master_joint joint ON rd.counterparty_id = joint.id
    WHERE DATE(rd.value_date) = ?
      AND LOWER(COALESCE(rd.approval_status, rd.status, '')) NOT IN ('rejected', 'cancelled')
    ORDER BY rd.deal_number
    `,
    [dateStr]
  );

  return (rows || []).map((row, idx) => {
    const amount = parseFloat(row.principal_amount || 0);
    const banks = withBankAmount(row.settlement_mode, amount, settlementByCode);
    const cp = row.counterparty_name || '';
    const isReverse = String(row.deal_type || '').toLowerCase().includes('reverse');
    // Maturity: Reverse=Add, Repo=Less → start leg is the opposite.
    const cashFlow = isReverse ? 'Less' : 'Add';
    return {
      id: row.id || `repo-set-${idx}`,
      deal_number: row.deal_number,
      deal_type: 'repo',
      event_type: 'settlement',
      instrument: isReverse ? 'Reverse Repo' : 'Repo',
      cash_flow: cashFlow,
      description: isReverse
        ? `Placement of Reverse Repo - ${cp}`
        : `Placement of Repo - ${cp}`,
      reference_deal_number: null,
      isin: row.isin || '',
      portfolio: null,
      counterparty: cp,
      face_value: amount,
      interest_amount: parseFloat(row.interest_amount || 0),
      maturity_amount: amount,
      maturity_date: row.maturity_date,
      value_date: row.value_date,
      days_to_maturity: 0,
      val_mat: 'On Value Date',
      settlement_mode: row.settlement_mode,
      banks,
      status: row.deal_status || 'Active',
      approval_level: 'not_initiated',
      approval_level_display: 'Settled',
      is_selectable: false
    };
  });
}

async function queryBuybackLeg1Settlements(dateStr, settlementByCode) {
  // Leg2 on this date is already covered by the maturity (leg2) query.
  // Add leg1 cash when leg1_value_date = D, unless a GSEC letter already represents it.
  const [rows] = await db.query(
    `
    SELECT
      bb.id,
      bb.deal_number,
      bb.leg1_isin AS isin,
      bb.leg1_portfolio AS portfolio,
      bb.leg1_transaction_type,
      bb.leg2_transaction_type,
      bb.leg1_settlement_mode,
      bb.leg1_settlement_amount,
      bb.leg1_value_date,
      bb.leg1_accrued_interest,
      bb.source_buy_deal_number,
      COALESCE(bb.leg1_adjusted_face_value, bb.leg1_face_value) AS face_value,
      bb.deal_status,
      COALESCE(corp.short_name, ind.short_name, joint.short_name, CONCAT('ID:', bb.leg1_counterparty)) AS counterparty_name
    FROM buyback_deals bb
    LEFT JOIN counterparty_master_corporate corp ON
      (bb.leg1_counterparty LIKE 'c%' AND CAST(SUBSTRING(bb.leg1_counterparty, 2) AS UNSIGNED) = corp.id)
      OR (bb.leg1_counterparty = corp.id)
    LEFT JOIN counterparty_master_individual ind ON
      (bb.leg1_counterparty LIKE 'i%' AND CAST(SUBSTRING(bb.leg1_counterparty, 2) AS UNSIGNED) = ind.id)
      OR (bb.leg1_counterparty = ind.id)
    LEFT JOIN counterparty_master_joint joint ON
      (bb.leg1_counterparty LIKE 'j%' AND CAST(SUBSTRING(bb.leg1_counterparty, 2) AS UNSIGNED) = joint.id)
      OR (bb.leg1_counterparty = joint.id)
    WHERE DATE(bb.leg1_value_date) = ?
      AND LOWER(COALESCE(bb.deal_status, '')) NOT IN ('rejected', 'cancelled')
      AND NOT EXISTS (
        SELECT 1 FROM gsec g
        WHERE g.buyback_deal_id = bb.id
          AND DATE(g.value_date) = DATE(bb.leg1_value_date)
          AND LOWER(COALESCE(g.status, '')) NOT IN ('cancelled', 'rejected')
      )
    ORDER BY bb.deal_number
    `,
    [dateStr]
  );

  return (rows || []).map((row, idx) => {
    const amount = parseFloat(row.leg1_settlement_amount || 0);
    const banks = withBankAmount(row.leg1_settlement_mode, amount, settlementByCode);
    const cp = row.counterparty_name || '';
    const leg1 = String(row.leg1_transaction_type || '').toLowerCase();
    const leg2 = String(row.leg2_transaction_type || '').toLowerCase();
    const isSellBuy = leg1 === 'sell' && leg2 === 'buy';
    const instrument = isSellBuy ? 'Sell-Buy' : 'Buy-Sell';
    const cashFlow = leg1 === 'sell' ? 'Add' : 'Less';
    const description = leg1 === 'sell'
      ? `Sale of T.Bond (leg1) - ${cp}`
      : `Purchase of T.Bond (leg1) - ${cp}`;

    return {
      id: row.id || `bb-set-${idx}`,
      deal_number: row.deal_number,
      deal_type: 'buyback',
      event_type: 'settlement',
      instrument,
      cash_flow: cashFlow,
      description,
      reference_deal_number: row.source_buy_deal_number || null,
      isin: row.isin,
      portfolio: row.portfolio,
      counterparty: cp,
      face_value: parseFloat(row.face_value || 0),
      interest_amount: parseFloat(row.leg1_accrued_interest || 0),
      maturity_amount: amount,
      maturity_date: row.leg1_value_date,
      value_date: row.leg1_value_date,
      days_to_maturity: 0,
      val_mat: 'On Value Date',
      settlement_mode: row.leg1_settlement_mode,
      banks,
      status: row.deal_status || 'Approved',
      approval_level: 'not_initiated',
      approval_level_display: 'Settled',
      is_selectable: false
    };
  });
}

/**
 * @param {string} dateStr YYYY-MM-DD
 * @param {{ type?: string, status?: string }} options
 */
async function getDailyMaturityCashflow(dateStr, options = {}) {
  const { type = 'all', status = 'all' } = options;
  const selectedYmd = toYmd(dateStr);
  const systemRow = await getSystemDay();
  const systemYmd = toYmd(systemRow && (systemRow.system_date || systemRow.systemDay));
  const viewMode = resolveViewMode(selectedYmd, systemYmd);
  const includeSettlements = false;

  const settlementByCode = await loadSettlementAccounts();

  const wantMM = !type || type === 'all' || type === 'money_market';
  const wantGsec = !type || type === 'all' || type === 'gsec';
  const wantRepo = !type || type === 'all' || type === 'repo';
  const wantBuyback = !type || type === 'all' || type === 'buyback';

  const maturityChunks = await Promise.all([
    wantMM ? queryMoneyMarket(selectedYmd, settlementByCode) : [],
    wantGsec ? queryGsec(selectedYmd, settlementByCode) : [],
    wantRepo ? queryRepo(selectedYmd, settlementByCode) : [],
    wantBuyback ? queryBuyback(selectedYmd, settlementByCode) : []
  ]);

  let rows = maturityChunks.flat().map(withSettlementValue);

  // Stable unique key so the same deal can appear as maturity + settlement without collapsing.
  const seen = new Set();
  rows = rows.filter((row) => {
    const key = `${row.deal_type}|${row.event_type}|${row.id}|${row.cash_flow}|${toYmd(row.value_date)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  rows.sort((a, b) => {
    const ev = String(a.event_type || '').localeCompare(String(b.event_type || ''));
    if (ev !== 0) return ev; // maturity before settlement alphabetically? 'maturity' < 'settlement' — ok
    const inst = (a.instrument || '').localeCompare(b.instrument || '');
    if (inst !== 0) return inst;
    return String(a.deal_number || '').localeCompare(String(b.deal_number || ''));
  });

  if (status && status !== 'all') {
    rows = rows.filter((d) => String(d.status || '').toLowerCase() === status.toLowerCase());
  }

  await attachOpeningBalances(rows, selectedYmd);
  const totals = buildTotals(rows);

  return {
    rows,
    totals,
    date: selectedYmd,
    system_date: systemYmd || null,
    view_mode: viewMode,
    include_settlements: includeSettlements
  };
}

module.exports = {
  getDailyMaturityCashflow,
  resolveViewMode,
  BANK_KEYS
};
