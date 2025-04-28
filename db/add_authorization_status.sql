-- Check if authorization_status column exists
SET @columnExists = 0;
SELECT COUNT(*) INTO @columnExists FROM information_schema.columns 
WHERE table_schema = DATABASE() AND table_name = 'transactions' AND column_name = 'authorization_status';

-- Add authorization_status column to transactions table if it doesn't exist
SET @sql = IF(@columnExists = 0, 
  'ALTER TABLE transactions ADD COLUMN authorization_status ENUM("pending", "authorized", "rejected") DEFAULT "pending"', 
  'SELECT "Column already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Set all existing transactions to 'pending' status
UPDATE transactions SET authorization_status = 'pending' WHERE authorization_status IS NULL;
