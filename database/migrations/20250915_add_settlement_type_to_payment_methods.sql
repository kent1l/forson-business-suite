-- Add settlement_type column to payment_methods table
-- This defines how each payment method handles settlement timing

-- Add settlement_type enum column
ALTER TABLE public.payment_methods 
ADD COLUMN IF NOT EXISTS settlement_type VARCHAR(20) NOT NULL DEFAULT 'instant'
CHECK (settlement_type IN ('instant', 'delayed', 'on_account'));

-- Update existing payment methods with appropriate settlement types
UPDATE public.payment_methods 
SET settlement_type = CASE 
    WHEN type = 'cash' THEN 'instant'
    WHEN type = 'card' THEN 'instant'
    WHEN type = 'mobile' THEN 'instant'
    WHEN type = 'bank' THEN 'delayed'
    WHEN type = 'credit' THEN 'on_account'
    ELSE 'instant'
END
WHERE settlement_type = 'instant'; -- Only update if still default

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_payment_methods_settlement_type ON public.payment_methods(settlement_type);

-- Update config for existing methods to include settlement-related settings
UPDATE public.payment_methods 
SET config = config || jsonb_build_object(
    'settlement_type', settlement_type,
    'settlement_description', CASE settlement_type
        WHEN 'instant' THEN 'Funds received immediately'
        WHEN 'delayed' THEN 'Funds settle later (bank transfer, cheque)'
        WHEN 'on_account' THEN 'No payment now - invoice remains due'
        ELSE 'Funds received immediately'
    END
)
WHERE NOT (config ? 'settlement_type');

-- Add helpful comment
COMMENT ON COLUMN public.payment_methods.settlement_type IS 'Defines when payment is considered settled: instant (immediately), delayed (pending settlement), on_account (no payment - invoice remains due)';