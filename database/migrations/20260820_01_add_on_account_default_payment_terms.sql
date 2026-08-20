-- Migration: default payment terms for invoicing and on-account sales.
-- Date: 2026-08-20 (Asia/Manila)
--
-- DEFAULT_PAYMENT_TERMS was a freeform text setting parsed by regex on the
-- frontend (InvoicingPage.jsx) to derive a days-to-due number. It doubled as
-- the printed terms label on Statements of Account (arRoutes.js
-- fetchGlobalCompanySettings -> soaPdf.js), so it must stay human-readable
-- text like "30 days", not a bare integer.
--
-- Adds a second, independent setting so "On Account" sales (a credit
-- settlement type distinct from cash/instant methods, see
-- payment_methods.config.settlement_type) can default to their own payment
-- terms rather than sharing the general invoicing default.
--
-- Also backfills DEFAULT_PAYMENT_TERMS to "30 days" for installs that never
-- customized it away from the stock seed ("Due upon receipt"), per request
-- to default the invoicing page's Payment Terms field to 30 days.

BEGIN;

INSERT INTO public.settings (setting_key, setting_value) VALUES
    ('DEFAULT_ON_ACCOUNT_PAYMENT_TERMS', '30 days')
ON CONFLICT (setting_key) DO NOTHING;

UPDATE public.settings
SET setting_value = '30 days'
WHERE setting_key = 'DEFAULT_PAYMENT_TERMS'
  AND setting_value = 'Due upon receipt';

COMMIT;
