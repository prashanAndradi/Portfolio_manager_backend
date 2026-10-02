'use strict';

function parseSellDealAllocations(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Sum sell reductions per buy deal as-of a date.
 * Multi-lot sells store the true split in sell_deal_allocations.
 * Pass { excludeRejected: true } to skip rejected Sells (used by the
 * available-to-sell balance in the sell modal, where a rejected Sell must
 * not keep consuming the Buy deal's balance).
 *
 * Sells linked via buyback_deal_id are excluded: Sell/Buy buybacks already
 * reduce inventory through remaining_face_value + buyback_deals deduction
 * logic; counting those letter-only Sell rows here would double-deduct.
 */
async function buildSoldByDealMap(db, dealNumbers, asAtDate, { excludeRejected = false } = {}) {
  const soldByDeal = {};
  if (!dealNumbers.length) return soldByDeal;

  const dealSet = new Set(dealNumbers.map((d) => String(d || '').trim()).filter(Boolean));
  const normalized = [...dealSet];
  if (!normalized.length) return soldByDeal;

  let hasBuybackDealIdCol = false;
  try {
    const [cols] = await db.query(`
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'gsec'
        AND COLUMN_NAME = 'buyback_deal_id'
      LIMIT 1
    `);
    hasBuybackDealIdCol = Array.isArray(cols) && cols.length > 0;
  } catch (_) {
    /* leave false */
  }

  const placeholders = normalized.map(() => '?').join(',');
  let sql = `
    SELECT TRIM(buy_deal_number) AS buy_deal_number, face_value, sell_deal_allocations
    FROM gsec
    WHERE transaction_type = 'Sell'
      AND (
        TRIM(buy_deal_number) IN (${placeholders})
        OR sell_deal_allocations IS NOT NULL
      )
  `;
  const params = [...normalized];

  if (hasBuybackDealIdCol) {
    sql += ' AND buyback_deal_id IS NULL';
  }

  if (excludeRejected) {
    sql += " AND COALESCE(status, '') <> 'rejected'";
  }

  if (asAtDate) {
    sql += ' AND DATE(value_date) <= DATE(?)';
    params.push(asAtDate);
  }

  const [sellRows] = await db.query(sql, params);
  for (const row of sellRows) {
    const allocations = parseSellDealAllocations(row.sell_deal_allocations);
    if (allocations) {
      for (const alloc of allocations) {
        const buyDealNumber = String((alloc.deal_number || alloc.buy_deal_number) || '').trim();
        const amount = Number(alloc.amountToSell || alloc.faceValue) || 0;
        if (buyDealNumber && dealSet.has(buyDealNumber) && amount > 0) {
          soldByDeal[buyDealNumber] = (soldByDeal[buyDealNumber] || 0) + amount;
        }
      }
      continue;
    }

    const buyDealNumber = String(row.buy_deal_number || '').trim();
    const amount = Number(row.face_value) || 0;
    if (buyDealNumber && dealSet.has(buyDealNumber) && amount > 0) {
      soldByDeal[buyDealNumber] = (soldByDeal[buyDealNumber] || 0) + amount;
    }
  }

  return soldByDeal;
}

/**
 * Deal numbers that already have a REAL sell link recorded somewhere - as a Sell row's
 * own buy_deal_number, or named in some Sell's sell_deal_allocations - regardless of
 * that Sell's date. Used to keep the unlinked-sell FIFO fallback below away from a Buy
 * deal that already has a known, specific disposition on record (e.g. bought with a
 * backdated value_date and sold the next day via a properly-linked Sell): that Buy's
 * fate is already accounted for and must not also be guessed at to resolve a different,
 * unrelated unlinked Sell just because it happens to still look "available" as of an
 * as-at date that falls before its own recorded Sell's date.
 *
 * Excludes rejected/cancelled Sells (never executed) and buyback-linked Sells (handled
 * by the separate buyback deduction logic, not this one) - same exclusions as
 * buildSoldByDealMap.
 */
async function findDealsWithAnyProperSellLink(db, dealNumbers) {
  const linked = new Set();
  const normalized = [...new Set(dealNumbers.map((d) => String(d || '').trim()).filter(Boolean))];
  if (!normalized.length) return linked;

  let hasBuybackDealIdCol = false;
  try {
    const [cols] = await db.query(`
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gsec' AND COLUMN_NAME = 'buyback_deal_id'
      LIMIT 1
    `);
    hasBuybackDealIdCol = Array.isArray(cols) && cols.length > 0;
  } catch (_) {
    /* leave false */
  }

  const placeholders = normalized.map(() => '?').join(',');
  let sql = `
    SELECT TRIM(buy_deal_number) AS buy_deal_number, sell_deal_allocations
    FROM gsec
    WHERE transaction_type = 'Sell'
      AND COALESCE(status, '') NOT IN ('rejected', 'cancelled')
      AND (TRIM(buy_deal_number) IN (${placeholders}) OR sell_deal_allocations IS NOT NULL)
  `;
  const params = [...normalized];
  if (hasBuybackDealIdCol) sql += ' AND buyback_deal_id IS NULL';

  const [rows] = await db.query(sql, params);
  const dealSet = new Set(normalized);
  for (const row of rows) {
    const direct = String(row.buy_deal_number || '').trim();
    if (direct && dealSet.has(direct)) linked.add(direct);

    const allocations = parseSellDealAllocations(row.sell_deal_allocations);
    if (allocations) {
      for (const alloc of allocations) {
        const buyDealNumber = String((alloc.deal_number || alloc.buy_deal_number) || '').trim();
        if (buyDealNumber && dealSet.has(buyDealNumber)) linked.add(buyDealNumber);
      }
    }
  }
  return linked;
}

/**
 * Allocate one "unlinked" sell (missing buy_deal_number) against its ISIN+portfolio's
 * candidate Buy deals, mutating `soldByDeal` (keyed by deal_number) in place.
 *
 * `fifoBuys` should already exclude any Buy deal returned by
 * findDealsWithAnyProperSellLink - a deal with a known, specific disposition on record
 * must never be used to absorb an unrelated unlinked sell's guess.
 *
 * Only allocates to a single Buy deal that can absorb the whole sell on its own - the
 * tightest such fit. If no single remaining candidate has enough capacity, the sell is
 * left unallocated rather than draining partial capacity across multiple lots: a sell
 * with no recorded link almost always corresponds to exactly one Buy lot, so fragmenting
 * it across several (including small, unrelated leftover lots) only ever produced
 * fictitious partial balances with no real meaning. Leaving a genuinely unattributable
 * sell unallocated slightly overstates total holdings by a known, visible gap - a far
 * safer failure mode than silently hiding a real position.
 *
 * @param {Array<{deal_number: string, face_value: number}>} fifoBuys - oldest first
 * @param {number} sellFaceValue
 * @param {Record<string, number>} soldByDeal - mutated in place
 */
function allocateUnlinkedSellFIFO(fifoBuys, sellFaceValue, soldByDeal) {
  const total = Number(sellFaceValue) || 0;
  if (!(total > 0) || !Array.isArray(fifoBuys) || !fifoBuys.length) return;

  const available = (c) => Math.max(0, (Number(c.face_value) || 0) - (Number(soldByDeal[c.deal_number]) || 0));

  let bestSingle = null;
  for (const c of fifoBuys) {
    const cap = available(c);
    if (cap + 0.005 < total) continue; // can't cover the sell alone
    if (!bestSingle || cap < available(bestSingle)) bestSingle = c;
  }
  if (bestSingle) {
    soldByDeal[bestSingle.deal_number] = (Number(soldByDeal[bestSingle.deal_number]) || 0) + total;
  }
  // No single candidate covers it - leave unallocated (see doc comment above).
}

/** Naive legacy sum used by old report/EOD code: SUM(face_value) by buy_deal_number. */
async function buildNaiveSoldByDealMap(db, dealNumbers, asAtDate) {
  const soldByDeal = {};
  if (!dealNumbers.length) return soldByDeal;

  const normalized = [...new Set(dealNumbers.map((d) => String(d || '').trim()).filter(Boolean))];
  const placeholders = normalized.map(() => '?').join(',');

  let hasBuybackDealIdCol = false;
  try {
    const [cols] = await db.query(`
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'gsec'
        AND COLUMN_NAME = 'buyback_deal_id'
      LIMIT 1
    `);
    hasBuybackDealIdCol = Array.isArray(cols) && cols.length > 0;
  } catch (_) {
    /* leave false */
  }

  let sql = `
    SELECT TRIM(buy_deal_number) AS buy_deal_number, COALESCE(SUM(face_value), 0) AS total_sold
    FROM gsec
    WHERE transaction_type = 'Sell'
      AND buy_deal_number IS NOT NULL
      AND TRIM(buy_deal_number) IN (${placeholders})
  `;
  const params = [...normalized];
  if (hasBuybackDealIdCol) {
    sql += ' AND buyback_deal_id IS NULL';
  }
  if (asAtDate) {
    sql += ' AND DATE(value_date) <= DATE(?)';
    params.push(asAtDate);
  }
  sql += ' GROUP BY TRIM(buy_deal_number)';

  const [rows] = await db.query(sql, params);
  for (const row of rows) {
    const key = String(row.buy_deal_number || '').trim();
    if (key) soldByDeal[key] = Number(row.total_sold) || 0;
  }
  return soldByDeal;
}

/**
 * Buy deals where multi-lot sells caused the legacy SUM(face_value) path to
 * over-deduct the primary buy_deal_number.
 */
async function findMultiLotOvercountDeals(db) {
  const [sellRows] = await db.query(
    `SELECT TRIM(buy_deal_number) AS buy_deal_number, face_value, sell_deal_allocations
     FROM gsec
     WHERE transaction_type = 'Sell' AND sell_deal_allocations IS NOT NULL`
  );
  const affected = new Set();
  for (const row of sellRows) {
    const allocations = parseSellDealAllocations(row.sell_deal_allocations);
    if (!allocations) continue;
    const primaryBuy = String(row.buy_deal_number || '').trim();
    const sellFace = Number(row.face_value) || 0;
    if (!primaryBuy || sellFace <= 0) continue;
    const allocToPrimary = allocations
      .filter((a) => String((a.deal_number || a.buy_deal_number) || '').trim() === primaryBuy)
      .reduce((sum, a) => sum + (Number(a.amountToSell || a.faceValue) || 0), 0);
    if (allocToPrimary > 0 && allocToPrimary < sellFace) {
      affected.add(primaryBuy);
    }
  }
  return affected;
}

module.exports = {
  parseSellDealAllocations,
  buildSoldByDealMap,
  allocateUnlinkedSellFIFO,
  findDealsWithAnyProperSellLink,
  buildNaiveSoldByDealMap,
  findMultiLotOvercountDeals
};
