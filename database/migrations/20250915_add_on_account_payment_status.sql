-- Migration: Add 'on_account' to allowed payment_status values
-- Date: 2025-09-15
-- Description: Allow 'on_account' as a valid payment_status for auditable on-account charges

-- First check if there's already a check constraint on payment_status
-- If there is, we'll drop it and recreate with the new value
-- If not, we'll add one

-- Check current payment_status values
DO $$
BEGIN
    -- Try to find existing payment_status constraint
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conrelid = 'invoice_payments'::regclass 
        AND pg_get_constraintdef(oid) ILIKE '%payment_status%'
    ) THEN
        -- Drop existing constraint if it exists
        EXECUTE (
            SELECT 'ALTER TABLE invoice_payments DROP CONSTRAINT ' || conname || ';'
            FROM pg_constraint 
            WHERE conrelid = 'invoice_payments'::regclass 
            AND pg_get_constraintdef(oid) ILIKE '%payment_status%'
            LIMIT 1
        );
    END IF;
    
    -- Add new constraint allowing settled, pending, and on_account
    ALTER TABLE invoice_payments 
    ADD CONSTRAINT chk_payment_status 
    CHECK (payment_status IN ('settled', 'pending', 'on_account'));
    
END $$;

-- Update existing payment_status default to handle on_account properly
ALTER TABLE invoice_payments 
ALTER COLUMN payment_status 
SET DEFAULT 'settled';

-- Add comment
COMMENT ON COLUMN invoice_payments.payment_status IS 'Payment status: settled (funds received), pending (awaiting settlement), on_account (AR charge)';