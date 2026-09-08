-- Fix Fixed Deposit requests that have status='Approved' but should be 'pending' for authorization
-- This updates records that have current_approval_level='back_office_final' but status='Approved'
-- to have status='pending' so they appear in the authorizer blotter

UPDATE fixed_deposit_requests 
SET status = 'pending',
    updated_at = NOW()
WHERE current_approval_level = 'back_office_final' 
  AND LOWER(TRIM(status)) = 'approved'
  AND (approved_at IS NULL OR approved_at = '0000-00-00 00:00:00');

-- Verify the update
SELECT id, request_no, status, current_approval_level, approved_at 
FROM fixed_deposit_requests 
WHERE current_approval_level = 'back_office_final' 
  AND LOWER(TRIM(status)) = 'pending';
