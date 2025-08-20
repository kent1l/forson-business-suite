-- Migration: create payment_term lookup table and seed common records
BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_term (
    payment_term_id serial PRIMARY KEY,
    days integer NOT NULL,
    label text
);

-- Seed common entries if not exist
INSERT INTO public.payment_term (days, label)
SELECT d.days, d.label FROM (VALUES
    (0, 'Due on receipt'),
    (7, '7 days'),
    (15, '15 days'),
    (30, '30 days')
) AS d(days, label)
ON CONFLICT (days) DO NOTHING;

COMMIT;
