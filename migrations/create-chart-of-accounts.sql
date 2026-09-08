-- Create chart_of_accounts table
-- This table stores the hierarchical chart of accounts structure

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  account_type_id INT NOT NULL,
  parent_account_id INT,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (account_type_id) REFERENCES account_types(id),
  FOREIGN KEY (parent_account_id) REFERENCES chart_of_accounts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Create index on account_code for faster lookups. A prefix length is given
-- so this also works against a pre-existing chart_of_accounts table whose
-- account_code column is TEXT rather than VARCHAR(20) (seen in production -
-- MySQL requires an explicit key length to index a BLOB/TEXT column).
CREATE INDEX idx_account_code ON chart_of_accounts(account_code(20));

-- Create index on account_type_id
CREATE INDEX idx_account_type_id ON chart_of_accounts(account_type_id);

-- Create index on parent_account_id. Same prefix-length reasoning as above -
-- production has this column as TEXT rather than INT.
CREATE INDEX idx_parent_account_id ON chart_of_accounts(parent_account_id(20));
