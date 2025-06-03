CREATE TABLE IF NOT EXISTS strategy_master (
  strategy_id VARCHAR(64) PRIMARY KEY,
  portfolio_name VARCHAR(128) NOT NULL,
  strategy_type VARCHAR(64),
  entity_business_unit VARCHAR(64)
);
