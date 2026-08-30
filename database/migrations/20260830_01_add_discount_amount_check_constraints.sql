-- Migration: Constrain line discounts to never exceed the line's own subtotal
-- Date: 2026-08-30 (Asia/Manila)
--
-- A discount larger than (quantity * sale_price) drives the line total negative,
-- and the tax calculation splits that negative total into a negative tax base and
-- a negative tax amount. Nothing downstream checks the sign: validateTaxCalculation
-- only verifies that the line figures sum to the invoice totals, which a
-- consistently-negative line satisfies perfectly. The bad figure then flows into
-- invoice_tax_breakdown and out to the VAT reports.
--
-- The application now rejects this at the route (invoiceRoutes.js, stagedSaleRoutes.js)
-- and again in computeTaxForBase(). These constraints are the last line of defence,
-- covering any path that bypasses both -- a script, an import, a future endpoint.
--
-- invoice_line already carries chk_tax_base_non_negative / chk_tax_amount_non_negative
-- from 20250918_add_tax_tracking_columns.sql, so rows written since then could not
-- have violated this anyway. staged_sale_line had no such backstop. Both tables were
-- checked for existing violations before writing this migration and both came back
-- clean, so the constraints are added validated rather than NOT VALID.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoice_line_discount_within_subtotal') THEN
        ALTER TABLE public.invoice_line
            ADD CONSTRAINT chk_invoice_line_discount_within_subtotal
            CHECK (COALESCE(discount_amount, 0) <= quantity * sale_price);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staged_sale_line_discount_within_subtotal') THEN
        ALTER TABLE public.staged_sale_line
            ADD CONSTRAINT chk_staged_sale_line_discount_within_subtotal
            CHECK (COALESCE(discount_amount, 0) <= quantity * sale_price);
    END IF;
END $$;

COMMIT;
