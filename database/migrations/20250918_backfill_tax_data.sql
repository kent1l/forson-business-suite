-- Tax backfill script for historical invoices
-- Created: 2025-09-18
-- Purpose: Safely backfill tax data for existing invoices
-- WARNING: Run this only after 20250918_add_tax_tracking_columns.sql

-- This script estimates tax amounts for historical invoices where tax data is missing
-- It marks all backfilled data as 'estimated' for audit purposes

DO $$
DECLARE
    backfill_run_uuid uuid := gen_random_uuid();
    default_tax_rate numeric(8,6);
    processed_count integer := 0;
    invoice_rec record;
    line_rec record;
    line_tax_base numeric(14,4);
    line_tax_amount numeric(14,2);
    invoice_subtotal numeric(14,2);
    invoice_tax_total numeric(14,2);
BEGIN
    -- Get default tax rate
    SELECT rate_percentage INTO default_tax_rate 
    FROM tax_rate 
    WHERE is_default = true 
    LIMIT 1;
    
    IF default_tax_rate IS NULL THEN
        default_tax_rate := 0.12; -- Fallback to 12% if no default set
        RAISE NOTICE 'No default tax rate found, using 12%% fallback';
    END IF;
    
    RAISE NOTICE 'Starting tax backfill with run ID: %', backfill_run_uuid;
    RAISE NOTICE 'Using default tax rate: %', (default_tax_rate * 100);
    
    -- Process invoices that don't have tax data
    FOR invoice_rec IN 
        SELECT i.invoice_id, i.invoice_number, i.total_amount
        FROM invoice i
        WHERE i.tax_total IS NULL 
        AND i.subtotal_ex_tax IS NULL
        ORDER BY i.invoice_id
    LOOP
        invoice_subtotal := 0;
        invoice_tax_total := 0;
        
        -- Process each line in the invoice
        FOR line_rec IN
            SELECT il.invoice_line_id, il.part_id, il.quantity, il.sale_price, 
                   COALESCE(il.discount_amount, 0) as discount_amount,
                   p.tax_rate_id, p.is_tax_inclusive_price,
                   tr.rate_percentage
            FROM invoice_line il
            JOIN part p ON il.part_id = p.part_id
            LEFT JOIN tax_rate tr ON p.tax_rate_id = tr.tax_rate_id
            WHERE il.invoice_id = invoice_rec.invoice_id
        LOOP
            -- Calculate line totals
            DECLARE
                line_total numeric(14,4) := line_rec.quantity * line_rec.sale_price - line_rec.discount_amount;
                tax_rate numeric(8,6) := COALESCE(line_rec.rate_percentage, default_tax_rate);
            BEGIN
                IF COALESCE(line_rec.is_tax_inclusive_price, false) = true THEN
                    -- Tax inclusive: extract tax from total
                    line_tax_base := line_total / (1 + tax_rate);
                    line_tax_amount := line_total - line_tax_base;
                ELSE
                    -- Tax exclusive: add tax to base
                    line_tax_base := line_total;
                    line_tax_amount := line_total * tax_rate;
                END IF;
                
                -- Round tax amount to 2 decimal places
                line_tax_amount := ROUND(line_tax_amount, 2);
                
                -- Update the invoice line with estimated tax data
                UPDATE invoice_line SET
                    tax_rate_id = line_rec.tax_rate_id,
                    tax_rate_snapshot = tax_rate,
                    tax_base = line_tax_base,
                    tax_amount = line_tax_amount,
                    is_tax_inclusive = COALESCE(line_rec.is_tax_inclusive_price, false)
                WHERE invoice_line_id = line_rec.invoice_line_id;
                
                -- Accumulate invoice totals
                invoice_subtotal := invoice_subtotal + line_tax_base;
                invoice_tax_total := invoice_tax_total + line_tax_amount;
            END;
        END LOOP;
        
        -- Update invoice totals
        UPDATE invoice SET
            subtotal_ex_tax = ROUND(invoice_subtotal, 2),
            tax_total = ROUND(invoice_tax_total, 2),
            tax_calculation_version = 'backfill_v1.0'
        WHERE invoice_id = invoice_rec.invoice_id;
        
        -- Create tax breakdown entries
        INSERT INTO invoice_tax_breakdown (invoice_id, tax_rate_id, rate_name, rate_percentage, tax_base, tax_amount, line_count)
        SELECT 
            invoice_rec.invoice_id,
            il.tax_rate_id,
            COALESCE(tr.rate_name, 'Default Rate'),
            il.tax_rate_snapshot,
            SUM(il.tax_base),
            SUM(il.tax_amount),
            COUNT(*)
        FROM invoice_line il
        LEFT JOIN tax_rate tr ON il.tax_rate_id = tr.tax_rate_id
        WHERE il.invoice_id = invoice_rec.invoice_id
        GROUP BY il.tax_rate_id, tr.rate_name, il.tax_rate_snapshot
        ON CONFLICT (invoice_id, tax_rate_id) DO UPDATE SET
            tax_base = EXCLUDED.tax_base,
            tax_amount = EXCLUDED.tax_amount,
            line_count = EXCLUDED.line_count;
        
        -- Log the backfill operation
        INSERT INTO tax_backfill_log (
            invoice_id, backfill_run_id, is_estimated, original_total,
            computed_subtotal, computed_tax, computation_method
        ) VALUES (
            invoice_rec.invoice_id, backfill_run_uuid, true, invoice_rec.total_amount,
            ROUND(invoice_subtotal, 2), ROUND(invoice_tax_total, 2), 'default_rate_estimation'
        );
        
        processed_count := processed_count + 1;
        
        -- Progress logging every 100 invoices
        IF processed_count % 100 = 0 THEN
            RAISE NOTICE 'Processed % invoices...', processed_count;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Tax backfill completed. Processed % invoices with run ID: %', processed_count, backfill_run_uuid;
    
    -- Summary report
    RAISE NOTICE 'Summary: % invoices backfilled, % total tax amount estimated', 
        processed_count, 
        (SELECT SUM(computed_tax) FROM tax_backfill_log WHERE backfill_run_id = backfill_run_uuid);
        
END $$;