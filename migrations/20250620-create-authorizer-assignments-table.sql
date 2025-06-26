-- SQL migration for authorizer_assignments table
CREATE TABLE IF NOT EXISTS authorizer_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  role VARCHAR(32) NOT NULL,
  allowed_pages JSON NOT NULL,
  per_deal_limit DECIMAL(20,4) NOT NULL DEFAULT 0,
  per_day_limit DECIMAL(20,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
