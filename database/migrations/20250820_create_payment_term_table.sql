BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_term (
    payment_term_id serial PRIMARY KEY,
    term_name text NOT NULL,
    days_to_due integer NOT NULL,
    UNIQUE (days_to_due)
);

-- Seed common entries if not exist
INSERT INTO public.payment_term (term_name, days_to_due)
SELECT d.term_name, d.days_to_due FROM (VALUES
    ('Due on receipt', 0),
    ('7 days', 7),
    ('15 days', 15),
    ('30 days', 30)
) AS d(term_name, days_to_due)
ON CONFLICT (days_to_due) DO NOTHING;

COMMIT;
