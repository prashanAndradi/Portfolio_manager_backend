-- Add authorization columns to gsec table
ALTER TABLE gsec ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending' AFTER strategy;
ALTER TABLE gsec ADD COLUMN IF NOT EXISTS comment TEXT AFTER status;
ALTER TABLE gsec ADD COLUMN IF NOT EXISTS created_by INT AFTER comment;
ALTER TABLE gsec ADD COLUMN IF NOT EXISTS created_at DATETIME AFTER created_by;
ALTER TABLE gsec ADD COLUMN IF NOT EXISTS updated_by INT AFTER created_at;
ALTER TABLE gsec ADD COLUMN IF NOT EXISTS updated_at DATETIME AFTER updated_by;
ALTER TABLE gsec ADD COLUMN IF NOT EXISTS authorized_by INT AFTER updated_at;
ALTER TABLE gsec ADD COLUMN IF NOT EXISTS authorized_at DATETIME AFTER authorized_by;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_gsec_status ON gsec(status);
CREATE INDEX IF NOT EXISTS idx_gsec_created_by ON gsec(created_by);
