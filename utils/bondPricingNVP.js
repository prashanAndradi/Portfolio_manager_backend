const { parseISO, addMonths } = require('date-fns');

// Helper to truncate to 4 decimals
function truncate4(val) {
  return Math.floor(Number(val) * 10000) / 10000;
}

// Helper to safely parse ISO date strings
function safeParseISO(val) {
  if (!val) return null;
  if (typeof val === 'string') return parseISO(val);
  if (val instanceof Date) return val;
  return null;
}

// Calculate days difference between two dates (matching frontend exactly)
// Frontend uses: Math.round(Math.abs((date1 - date2) / millisecondsPerDay))
function getDaysDifference(date1, date2) {
  if (!date1 || !date2) return 0;
  const d1 = safeParseISO(date1);
  const d2 = safeParseISO(date2);
  if (!d1 || !d2) return 0;
  // Match frontend calculation exactly: Math.round(Math.abs((date1 - date2) / millisecondsPerDay))
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs((d1 - d2) / millisecondsPerDay));
}

// Generate full coupon schedule
function generateFullCouponSchedule(issueDate, maturityDate, couponDate1, couponDate2) {
  const schedule = [];
  const issue = safeParseISO(issueDate);
  const maturity = safeParseISO(maturityDate);
  
  if (!issue || !maturity) return schedule;
  
  // Parse coupon dates
  const c1 = safeParseISO(couponDate1);
  const c2 = safeParseISO(couponDate2);
  
  if (!c1 || !c2) return schedule;
  
  // Generate schedule from issue to maturity
  let currentDate = new Date(issue);
  const endDate = new Date(maturity);
  
  // Add issue date
  schedule.push(new Date(issue));
  
  // Generate coupon dates
  while (currentDate < endDate) {
    // Add 6 months for semi-annual coupons
    currentDate = addMonths(currentDate, 6);
    if (currentDate <= endDate) {
      schedule.push(new Date(currentDate));
    }
  }
  
  // Add maturity date
  schedule.push(new Date(maturity));
  
  return schedule;
}

// Calculate clean price using system date as value date
function calculateNVP({
  faceValue,
  couponRate,
  yieldRate,
  systemDate, // This will be the current system date
  maturityDate,
  issueDate,
  couponDate1,
  couponDate2,
  quiet = false // suppress per-call debug logging (used by solveYieldFromPrice's bisection search)
}) {
  if (!quiet) console.log("CALCULATE NVP FUNCTION CALLED");

  if (!faceValue || !couponRate || !yieldRate || !systemDate || !maturityDate || !issueDate || !couponDate1 || !couponDate2) {
    return { nvp: '', accruedInterest: '' };
  }

  // Fixed semi-annual frequency
  const frequency = 2;

  // Parse and normalize all date inputs
  const issue = safeParseISO(issueDate);
  const maturity = safeParseISO(maturityDate);
  const settle = safeParseISO(systemDate); // Use system date as value date
  const c1 = safeParseISO(couponDate1);
  const c2 = safeParseISO(couponDate2);

  if (!issue || !maturity || !settle || !c1 || !c2) {
    return { nvp: '', accruedInterest: '' };
  }

  // Find last and next coupon dates (matching frontend logic exactly)
  // Start from issue date and move forward until past settle date, then step back
  let lastCoupon = new Date(issue);
  const monthsPerPeriod = 12 / frequency; // 6 months for semi-annual

  // Move forward until we're past the settle date
  while (lastCoupon <= settle) {
    lastCoupon.setMonth(lastCoupon.getMonth() + monthsPerPeriod);
  }

  // Step back to get the last coupon date before settle date
  lastCoupon.setMonth(lastCoupon.getMonth() - monthsPerPeriod);

  // Create next coupon date by adding one period to last coupon
  const nextCoupon = new Date(lastCoupon);
  nextCoupon.setMonth(nextCoupon.getMonth() + monthsPerPeriod);

  const lastCouponDate = lastCoupon;
  const nextCouponDate = nextCoupon;

  // Calculate days for accrued interest
  const daysSinceLastCoupon = getDaysDifference(settle, lastCouponDate);
  const daysInCouponPeriod = getDaysDifference(nextCouponDate, lastCouponDate);
  
  if (daysInCouponPeriod === 0) {
    return { nvp: '', accruedInterest: '' };
  }

  // Use per-100 basis from the start (matching frontend calculation exactly)
  const fv = 100; // Always use 100 as face value for per-100 calculations
  const cr = Number(couponRate) / 100; // Convert percentage to decimal
  const ytm = Number(yieldRate) / 100; // Convert percentage to decimal
  // monthsPerPeriod already declared above

  // Calculate coupon payment per 100 (matching frontend)
  const coupon = fv * cr / frequency;
  const ytmPerPeriod = ytm / frequency;
  
  // Calculate fractional period (matching frontend logic exactly)
  // Fractional period = days from settle date to next coupon / days in coupon period
  const daysToNextCoupon = getDaysDifference(nextCouponDate, settle);
  const fractionalPeriod = daysToNextCoupon / daysInCouponPeriod;
  
  // Generate cash flows from next coupon to maturity (matching frontend)
  const cashFlows = [];
  let cfDate = new Date(nextCouponDate);
  let periodCount = 0;

  while (cfDate <= maturity) {
    const isFinal = cfDate.getTime() === maturity.getTime();
    const amount = isFinal ? coupon + fv : coupon; // Final includes face value
    cashFlows.push({
      date: new Date(cfDate),
      amount,
      periodCount
    });
    cfDate.setMonth(cfDate.getMonth() + monthsPerPeriod);
    periodCount++;
  }
  
  // Calculate present value of each cash flow (matching frontend)
  let dirtyPrice = 0;
  for (const cf of cashFlows) {
    const t = fractionalPeriod + cf.periodCount;
    const pv = cf.amount / Math.pow(1 + ytmPerPeriod, t);
    dirtyPrice += pv;
  }

  // Accrued interest per 100 (matching frontend logic)
  const daysAccrued = getDaysDifference(settle, lastCouponDate);
  const accruedInterest = coupon * (daysAccrued / daysInCouponPeriod);

  // NVP is ROUNDED to 4 decimals, and rounded ONCE, from the unrounded clean
  // price. Rounding dirty and accrued separately and then subtracting is not
  // the same thing: on 16-Oct-2026 that route gives 99.8937 where rounding the
  // clean price once gives 99.8936, which is the figure Finance reconciles to.
  //
  // It used to truncate. Truncation and rounding differ by one unit in the 4th
  // decimal, and because a day's pull to par is only ~0.0015 per 100, that one
  // unit moves the day's amortisation by around 7%.
  const round4 = (v) => Math.round(v * 10000) / 10000;

  const truncatedDirtyPrice = round4(dirtyPrice);
  const truncatedAccruedInterestPer100 = round4(accruedInterest);
  const cleanPrice = dirtyPrice - accruedInterest;
  const truncatedCleanPrice = round4(cleanPrice);

  // Debug logging with detailed calculation breakdown
  if (!quiet) {
    console.log('=== NVP Calculation Debug ===');
    console.log('Value Date (systemDate/asAtDate):', systemDate);
    console.log('Issue Date:', issueDate);
    console.log('Maturity Date:', maturityDate);
    console.log('Face Value (input):', faceValue, '(using fv=100 for calculation)');
    console.log('Coupon Rate:', couponRate);
    console.log('Yield Rate:', yieldRate);
    console.log('--- Coupon Dates ---');
    console.log('Last Coupon Date:', lastCouponDate.toISOString().split('T')[0]);
    console.log('Next Coupon Date:', nextCouponDate.toISOString().split('T')[0]);
    console.log('Settle Date:', settle.toISOString().split('T')[0]);
    console.log('--- Day Calculations (matching frontend) ---');
    console.log('Days Accrued (settle - lastCoupon):', daysAccrued);
    console.log('Days In Coupon Period (nextCoupon - lastCoupon):', daysInCouponPeriod);
    console.log('Days To Next Coupon (nextCoupon - settle):', daysToNextCoupon);
    console.log('Fractional Period (daysToNextCoupon / daysInCouponPeriod):', fractionalPeriod);
    console.log('--- Cash Flows ---');
    console.log('Number of cash flows:', cashFlows.length);
    cashFlows.forEach((cf, idx) => {
      const t = fractionalPeriod + cf.periodCount;
      const pv = cf.amount / Math.pow(1 + ytmPerPeriod, t);
      console.log(`  CF ${idx + 1}: date=${cf.date.toISOString().split('T')[0]}, amount=${cf.amount.toFixed(4)}, t=${t.toFixed(6)}, PV=${pv.toFixed(6)}`);
    });
    console.log('Raw Dirty Price (sum of PVs):', dirtyPrice);
    console.log('--- Final Values ---');
    console.log('Dirty Price Per 100 (rounded 4dp):', truncatedDirtyPrice);
    console.log('Accrued Interest Per 100 (rounded 4dp):', truncatedAccruedInterestPer100);
    console.log('Clean Price / NVP (rounded 4dp, once):', truncatedCleanPrice);
    console.log('================================');
  }

  return {
    nvp: truncatedCleanPrice.toFixed(4),
    accruedInterest: truncatedAccruedInterestPer100.toFixed(4),
    // Unrounded, for callers that need to compare two days without the 4dp
    // step. The posted amortisation deliberately uses the rounded `nvp`.
    nvpExact: cleanPrice,
    accruedInterestExact: accruedInterest
  };
}

/**
 * Inverse of calculateNVP: back-solve the yield that produces a given clean
 * price. Used when a clean/dirty price is computed by some other method
 * (e.g. simple-interest settlement on a premature buyback maturity) and the
 * bond's implied yield needs to be derived from it for display/reporting,
 * rather than the other way around.
 *
 * Clean price is monotonically decreasing in yield, so a plain bisection
 * search is robust here (no need for Newton-Raphson/derivatives).
 */
function solveYieldFromPrice({
  targetCleanPrice,
  faceValue,
  couponRate,
  systemDate,
  maturityDate,
  issueDate,
  couponDate1,
  couponDate2,
  minYield = 0.01,
  maxYield = 50,
  maxIterations = 60,
  tolerance = 0.00005
}) {
  const target = Number(targetCleanPrice);
  if (!isFinite(target)) return null;

  const priceAt = (yieldRate) => {
    const result = calculateNVP({
      faceValue, couponRate, yieldRate, systemDate, maturityDate, issueDate, couponDate1, couponDate2, quiet: true
    });
    const price = parseFloat(result.nvp);
    return isFinite(price) ? price : null;
  };

  let lo = minYield;
  let hi = maxYield;
  const priceAtLo = priceAt(lo);
  const priceAtHi = priceAt(hi);
  if (priceAtLo == null || priceAtHi == null) return null;
  // Price decreases as yield increases, so priceAtLo should be >= target >= priceAtHi.
  if (target > priceAtLo || target < priceAtHi) return null;

  let mid = (lo + hi) / 2;
  for (let i = 0; i < maxIterations; i += 1) {
    mid = (lo + hi) / 2;
    const priceAtMid = priceAt(mid);
    if (priceAtMid == null) return null;
    if (Math.abs(priceAtMid - target) <= tolerance) {
      return Math.round(mid * 1000000) / 1000000;
    }
    // Higher yield => lower price.
    if (priceAtMid > target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return Math.round(mid * 1000000) / 1000000;
}

module.exports = {
  calculateNVP,
  solveYieldFromPrice,
  truncate4
};
