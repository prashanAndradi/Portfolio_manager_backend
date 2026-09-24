// Share the same pool as config/db so report/auth paths do not open a
// second connection set (a cold pool fails with ENOTFOUND when DNS is flaky).
module.exports = require('../config/db');
