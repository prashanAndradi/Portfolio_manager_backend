-- Per-front-office-user dealing limits, distinct from counterparty exposure
-- limits (counterparty_limits) and from an authorizer's own approval limit
-- (authorizer_assignments.per_deal_limit/per_day_limit).
CREATE TABLE IF NOT EXISTS dealer_limits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  per_deal_limit DECIMAL(20,4) NOT NULL DEFAULT 0,
  per_day_limit DECIMAL(20,4) NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'LKR',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_currency (user_id, currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
