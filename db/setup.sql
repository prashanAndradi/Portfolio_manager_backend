-- Drop tables if they exist
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS transaction_types;
DROP TABLE IF EXISTS securities;
DROP TABLE IF EXISTS counterparties;
DROP TABLE IF EXISTS accounts;

-- Create accounts table
CREATE TABLE accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create transaction_types table
CREATE TABLE transaction_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create securities table
CREATE TABLE securities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(50),
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create counterparties table
CREATE TABLE counterparties (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(50),
  contact_info VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create transactions table
CREATE TABLE transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source_account_id INT NOT NULL,
  transaction_type_id INT NOT NULL,
  security_id INT,
  counterparty_id INT,
  amount DECIMAL(15, 2) NOT NULL,
  date DATE NOT NULL,
  trade_date DATE,
  value_date DATE,
  interest_rate DECIMAL(8, 4),
  settlement_mode VARCHAR(20),
  price DECIMAL(15, 4),
  yield DECIMAL(8, 4),
  portfolio VARCHAR(50),
  strategy VARCHAR(100),
  currency VARCHAR(10),
  transaction_code VARCHAR(50),
  commission DECIMAL(10, 2),
  brokerage DECIMAL(10, 2),
  remarks TEXT,
  user VARCHAR(100),
  description TEXT,
  authorization_status ENUM('pending', 'authorized', 'rejected') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_account_id) REFERENCES accounts(id),
  FOREIGN KEY (transaction_type_id) REFERENCES transaction_types(id),
  FOREIGN KEY (security_id) REFERENCES securities(id),
  FOREIGN KEY (counterparty_id) REFERENCES counterparties(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insert sample accounts
INSERT INTO accounts (name, balance) VALUES
  ('Savings Account', 5000.00),
  ('Fixed Deposit #1', 10000.00),
  ('Investment Account', 7500.00);
  

-- Insert transaction types
INSERT INTO transaction_types (name, description) VALUES
  ('Deposit', 'Deposit into account'),
  ('Withdrawal', 'Withdrawal from account'),
  ('Transfer', 'Transfer between accounts'),
  ('Bill Payment', 'Payment of bills'),
  ('Investment', 'Investment transaction');

-- Insert sample securities
INSERT INTO securities (name, type, description) VALUES
  ('Treasury Bills', 'Government', 'Short-term government debt'),
  ('Treasury Bonds', 'Government', 'Long-term government debt'),
  ('Corporate Bonds', 'Corporate', 'Debt issued by companies'),
  ('Equity Shares', 'Equity', 'Company shares');

-- Insert sample counterparties
INSERT INTO counterparties (name, type, contact_info) VALUES
  ('Bank A', 'Bank', 'contact@banka.com'),
  ('Bank B', 'Bank', 'contact@bankb.com'),
  ('Investment Firm C', 'Investment Firm', 'info@firmc.com'),
  ('Broker D', 'Broker', 'broker@d.com');

-- Insert sample transactions
INSERT INTO transactions (source_account_id, transaction_type_id, security_id, counterparty_id, amount, date, description) VALUES
  (1, 4, 1, 1, -120.50, '2025-04-05', 'Electric bill payment'),
  (1, 1, 2, 2, 2500.00, '2025-04-03', 'Salary deposit'),
  (3, 5, 3, 3, -1000.00, '2025-04-01', 'Stock purchase');