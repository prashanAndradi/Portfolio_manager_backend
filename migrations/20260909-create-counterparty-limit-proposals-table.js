/**
 * Approval workflow for counterparty limit setup.
 *
 * A middle_office_user's submission is staged here as a proposal rather than
 * written straight to counterparty_limits; a middle_office_officer or
 * middle_office_manager then approves or rejects it. Mirrors the dealer-limit
 * workflow.
 *
 * Unlike dealer_limits (which stages two pending_* columns in place), a
 * counterparty limit is a 17-column record, so the proposed values are held
 * as a JSON payload in a separate table instead of doubling every column.
 * On approval the payload is inserted into counterparty_limits.
 */
const db = require('../config/db');

async function createCounterpartyLimitProposalsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS counterparty_limit_proposals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      counterparty_id INT NOT NULL,
      counterparty_type VARCHAR(32) NOT NULL,
      payload JSON NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      proposed_by INT NULL,
      proposed_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      approved_by INT NULL,
      approved_at TIMESTAMP NULL,
      rejected_by INT NULL,
      rejected_at TIMESTAMP NULL,
      rejection_reason TEXT NULL,
      created_limit_id INT NULL,
      INDEX idx_status (status),
      INDEX idx_counterparty (counterparty_id, counterparty_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('counterparty_limit_proposals table ready');
}

if (require.main === module) {
  createCounterpartyLimitProposalsTable()
    .then(() => { console.log('Migration completed'); process.exit(0); })
    .catch((err) => { console.error('Migration failed:', err); process.exit(1); });
}

module.exports = createCounterpartyLimitProposalsTable;
