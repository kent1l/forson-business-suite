-- Backfill migration for existing databases to add payment methods support
-- This migration safely adds payment methods to existing databases and links legacy payments

BEGIN;

-- Step 1: Create payment_methods table if not exists (from latest migration)
CREATE TABLE IF NOT EXISTS public.payment_methods (
    method_id serial PRIMARY KEY,
    code character varying(50) NOT NULL UNIQUE,
    name character varying(100) NOT NULL,
    type character varying(20) NOT NULL DEFAULT 'other',
    enabled boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    config jsonb NOT NULL DEFAULT '{}',
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    
    CONSTRAINT chk_payment_method_type CHECK (
        type IN ('cash', 'card', 'bank', 'mobile', 'credit', 'voucher', 'other')
    )
);

-- Step 2: Add indexes for payment_methods if not exist
CREATE INDEX IF NOT EXISTS idx_payment_methods_enabled_sort ON public.payment_methods(enabled, sort_order);
CREATE INDEX IF NOT EXISTS idx_payment_methods_type ON public.payment_methods(type);

-- Step 3: Add method_id column to customer_payment if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'customer_payment' 
                   AND column_name = 'method_id') THEN
        ALTER TABLE public.customer_payment 
        ADD COLUMN method_id integer REFERENCES public.payment_methods(method_id) ON DELETE SET NULL;
        
        CREATE INDEX IF NOT EXISTS idx_customer_payment_method_id ON public.customer_payment(method_id);
    END IF;
END$$;

-- Step 4: Add physical_receipt_no to invoice if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'invoice' 
                   AND column_name = 'physical_receipt_no') THEN
        ALTER TABLE public.invoice 
        ADD COLUMN physical_receipt_no character varying(50);
    END IF;
END$$;

-- Step 5: Seed default payment methods if table is empty
INSERT INTO public.payment_methods (code, name, type, enabled, sort_order, config) 
SELECT * FROM (VALUES
    ('cash', 'Cash', 'cash', true, 1, '{
        "requires_reference": false,
        "requires_receipt_no": false,
        "change_allowed": true,
        "settlement_type": "instant",
        "max_split_count": null
    }'::jsonb),
    ('credit_card', 'Credit Card', 'card', true, 2, '{
        "requires_reference": true,
        "reference_label": "Auth Code",
        "requires_receipt_no": true,
        "change_allowed": false,
        "settlement_type": "instant",
        "max_split_count": 1
    }'::jsonb),
    ('debit_card', 'Debit Card', 'card', true, 3, '{
        "requires_reference": true,
        "reference_label": "Auth Code",
        "requires_receipt_no": true,
        "change_allowed": false,
        "settlement_type": "instant",
        "max_split_count": 1
    }'::jsonb),
    ('bank_transfer', 'Bank Transfer', 'bank', true, 4, '{
        "requires_reference": true,
        "reference_label": "Transfer Reference",
        "requires_receipt_no": false,
        "change_allowed": false,
        "settlement_type": "delayed",
        "max_split_count": null
    }'::jsonb),
    ('cheque', 'Cheque', 'bank', true, 5, '{
        "requires_reference": true,
        "reference_label": "Cheque Number",
        "requires_receipt_no": false,
        "change_allowed": false,
        "settlement_type": "delayed",
        "max_split_count": null
    }'::jsonb),
    ('gcash', 'GCash', 'mobile', true, 6, '{
        "requires_reference": true,
        "reference_label": "Transaction ID",
        "requires_receipt_no": false,
        "change_allowed": false,
        "settlement_type": "instant",
        "max_split_count": null
    }'::jsonb),
    ('paymaya', 'PayMaya', 'mobile', true, 7, '{
        "requires_reference": true,
        "reference_label": "Transaction ID",
        "requires_receipt_no": false,
        "change_allowed": false,
        "settlement_type": "instant",
        "max_split_count": null
    }'::jsonb)
) AS default_methods(code, name, type, enabled, sort_order, config)
WHERE NOT EXISTS (SELECT 1 FROM public.payment_methods LIMIT 1)
ON CONFLICT (code) DO NOTHING;

-- Step 6: Create payment methods from legacy PAYMENT_METHODS setting if it exists
DO $$
DECLARE
    legacy_methods text;
    method_name text;
    method_code text;
    method_type text;
BEGIN
    -- Get legacy payment methods from settings
    SELECT setting_value INTO legacy_methods 
    FROM public.settings 
    WHERE setting_key = 'PAYMENT_METHODS';
    
    IF legacy_methods IS NOT NULL THEN
        -- Split by comma and process each method
        FOR method_name IN 
            SELECT TRIM(unnest(string_to_array(legacy_methods, ',')))
        LOOP
            IF method_name != '' THEN
                -- Generate code (lowercase, replace spaces with underscores)
                method_code := LOWER(REPLACE(TRIM(method_name), ' ', '_'));
                
                -- Determine type based on name heuristics
                method_type := CASE 
                    WHEN LOWER(method_name) LIKE '%cash%' THEN 'cash'
                    WHEN LOWER(method_name) LIKE '%card%' OR LOWER(method_name) LIKE '%credit%' OR LOWER(method_name) LIKE '%debit%' THEN 'card'
                    WHEN LOWER(method_name) LIKE '%bank%' OR LOWER(method_name) LIKE '%transfer%' OR LOWER(method_name) LIKE '%cheque%' THEN 'bank'
                    WHEN LOWER(method_name) LIKE '%gcash%' OR LOWER(method_name) LIKE '%paymaya%' OR LOWER(method_name) LIKE '%mobile%' THEN 'mobile'
                    ELSE 'other'
                END;
                
                -- Insert if not exists
                INSERT INTO public.payment_methods (code, name, type, enabled, sort_order, config)
                VALUES (
                    method_code,
                    method_name,
                    method_type,
                    true,
                    (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.payment_methods),
                    CASE method_type
                        WHEN 'cash' THEN '{"requires_reference": false, "requires_receipt_no": false, "change_allowed": true, "settlement_type": "instant"}'::jsonb
                        WHEN 'card' THEN '{"requires_reference": true, "reference_label": "Reference", "requires_receipt_no": true, "change_allowed": false, "settlement_type": "instant"}'::jsonb
                        WHEN 'bank' THEN '{"requires_reference": true, "reference_label": "Reference", "requires_receipt_no": false, "change_allowed": false, "settlement_type": "delayed"}'::jsonb
                        WHEN 'mobile' THEN '{"requires_reference": true, "reference_label": "Transaction ID", "requires_receipt_no": false, "change_allowed": false, "settlement_type": "instant"}'::jsonb
                        ELSE '{"requires_reference": false, "requires_receipt_no": false, "change_allowed": true, "settlement_type": "instant"}'::jsonb
                    END
                )
                ON CONFLICT (code) DO NOTHING;
            END IF;
        END LOOP;
    END IF;
END$$;

-- Step 7: Create payment methods from existing customer_payment.payment_method values
DO $$
DECLARE
    method_name text;
    method_code text;
    method_type text;
BEGIN
    -- Get distinct payment method names from existing payments
    FOR method_name IN 
        SELECT DISTINCT TRIM(payment_method) 
        FROM public.customer_payment 
        WHERE payment_method IS NOT NULL 
        AND TRIM(payment_method) != ''
        AND NOT EXISTS (
            SELECT 1 FROM public.payment_methods pm 
            WHERE LOWER(pm.name) = LOWER(TRIM(payment_method))
        )
    LOOP
        -- Generate code (lowercase, replace spaces with underscores)
        method_code := LOWER(REPLACE(TRIM(method_name), ' ', '_'));
        
        -- Determine type based on name heuristics
        method_type := CASE 
            WHEN LOWER(method_name) LIKE '%cash%' THEN 'cash'
            WHEN LOWER(method_name) LIKE '%card%' OR LOWER(method_name) LIKE '%credit%' OR LOWER(method_name) LIKE '%debit%' THEN 'card'
            WHEN LOWER(method_name) LIKE '%bank%' OR LOWER(method_name) LIKE '%transfer%' OR LOWER(method_name) LIKE '%cheque%' THEN 'bank'
            WHEN LOWER(method_name) LIKE '%gcash%' OR LOWER(method_name) LIKE '%paymaya%' OR LOWER(method_name) LIKE '%mobile%' THEN 'mobile'
            ELSE 'other'
        END;
        
        -- Insert if not exists
        INSERT INTO public.payment_methods (code, name, type, enabled, sort_order, config)
        VALUES (
            method_code,
            method_name,
            method_type,
            true,
            (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.payment_methods),
            CASE method_type
                WHEN 'cash' THEN '{"requires_reference": false, "requires_receipt_no": false, "change_allowed": true, "settlement_type": "instant"}'::jsonb
                WHEN 'card' THEN '{"requires_reference": true, "reference_label": "Reference", "requires_receipt_no": true, "change_allowed": false, "settlement_type": "instant"}'::jsonb
                WHEN 'bank' THEN '{"requires_reference": true, "reference_label": "Reference", "requires_receipt_no": false, "change_allowed": false, "settlement_type": "delayed"}'::jsonb
                WHEN 'mobile' THEN '{"requires_reference": true, "reference_label": "Transaction ID", "requires_receipt_no": false, "change_allowed": false, "settlement_type": "instant"}'::jsonb
                ELSE '{"requires_reference": false, "requires_receipt_no": false, "change_allowed": true, "settlement_type": "instant"}'::jsonb
            END
        )
        ON CONFLICT (code) DO NOTHING;
    END LOOP;
END$$;

-- Step 8: Link existing customer_payment records to payment_methods
UPDATE public.customer_payment 
SET method_id = pm.method_id
FROM public.payment_methods pm
WHERE customer_payment.method_id IS NULL
AND customer_payment.payment_method IS NOT NULL
AND TRIM(customer_payment.payment_method) != ''
AND LOWER(pm.name) = LOWER(TRIM(customer_payment.payment_method));

-- Step 9: Add new settings for payment methods feature
INSERT INTO public.settings (setting_key, setting_value, description) VALUES
('ENABLE_SPLIT_PAYMENTS', 'false', 'Enable split payment functionality and payment methods management'),
('PAYMENT_METHODS_HELP_TEXT', 'Configure available payment methods and their validation rules', 'Help text shown in Payment Methods settings')
ON CONFLICT (setting_key) DO NOTHING;

-- Step 10: Output summary
DO $$
DECLARE
    method_count integer;
    linked_count integer;
    unlinked_count integer;
BEGIN
    SELECT COUNT(*) INTO method_count FROM public.payment_methods;
    SELECT COUNT(*) INTO linked_count FROM public.customer_payment WHERE method_id IS NOT NULL;
    SELECT COUNT(*) INTO unlinked_count FROM public.customer_payment WHERE method_id IS NULL AND payment_method IS NOT NULL;
    
    RAISE NOTICE 'Payment methods backfill completed:';
    RAISE NOTICE '- Total payment methods: %', method_count;
    RAISE NOTICE '- Linked legacy payments: %', linked_count;
    RAISE NOTICE '- Unlinked legacy payments: %', unlinked_count;
END$$;

COMMIT;
