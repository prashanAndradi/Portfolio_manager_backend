// Pin the process to UTC. All date logic assumes it: the DB pool reads DATE columns as
// UTC midnight (timezone '+00:00') and dates are compared as toISOString().slice(0, 10).
// On a host running local time (e.g. Asia/Colombo, +05:30) those disagree by a day, which
// shifts coupon dates, drops the redemption cash flow from NVP and truncates cumulative
// accrual - so the same report gave different figures on UTC and +05:30 servers.
// Required first by server.js and the DB config modules so scripts get it too.
process.env.TZ = 'UTC';
