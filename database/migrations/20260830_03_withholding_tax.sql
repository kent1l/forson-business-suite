-- Migration: Creditable withholding tax on sales (BIR Forms 2307 and 2306)
-- Date: 2026-08-30 (Asia/Manila)
--
-- Customers that BIR has designated as withholding agents, and all government
-- buyers, do not pay the full invoice. They deduct tax at source, remit it under
-- our TIN, and hand over a certificate proving they did. Two separate taxes are
-- withheld, both computed on the VAT-EXCLUSIVE amount:
--
--   * Expanded withholding tax (EWT) -- 1% on goods, 2% on services, evidenced by
--     Form 2307. Creditable against our INCOME tax. Does not touch output VAT.
--   * Withholding VAT -- 5%, government buyers only. Historically a final tax on
--     Form 2306; under TRAIN this shifted to a creditable system from 1 Jan 2021.
--     Agencies are inconsistent about which form they issue, so the accounting
--     `treatment` is stored separately from the form number: a change in BIR
--     practice then becomes a data change rather than a migration.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: reduce the invoice total. The receivable is
-- still the full amount; withholding only changes how it is settled -- part in
-- cash, part by tax certificate. Netting it off the invoice would understate
-- revenue and misstate output VAT, which is declared in full regardless.
--
-- Settlement therefore reuses the existing invoice_payments machinery (a
-- withholding line is just another instrument, like store wallet), so the invoice
-- balance trigger, AR aging, and split payments all keep working untouched.

BEGIN;

-- ────────────────────────────────────────────
-- 1. Who withholds, and under whose TIN.
-- ────────────────────────────────────────────
-- A certificate is keyed on TIN, not name, and the registered name on the
-- certificate often differs from the trading name we invoice ("company_name").
-- Both are needed to reconcile a received 2307 against our own records.
ALTER TABLE public.customer
    ADD COLUMN IF NOT EXISTS tin                  VARCHAR(20),
    ADD COLUMN IF NOT EXISTS registered_name      VARCHAR(255),
    ADD COLUMN IF NOT EXISTS is_withholding_agent BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS customer_type        VARCHAR(20) NOT NULL DEFAULT 'PRIVATE';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_customer_type') THEN
        ALTER TABLE public.customer ADD CONSTRAINT chk_customer_type
            CHECK (customer_type IN ('PRIVATE', 'GOVERNMENT'));
    END IF;
END $$;

-- Only withholding customers are ever scanned when building the chase list.
CREATE INDEX IF NOT EXISTS idx_customer_withholding_agent
    ON public.customer (is_withholding_agent) WHERE is_withholding_agent;

COMMENT ON COLUMN public.customer.is_withholding_agent IS
    'True when this buyer deducts tax at source. A BIR designation, not a per-sale choice, so it is derived from the customer rather than selected by the cashier.';

-- ────────────────────────────────────────────
-- 2. Rates and our own registration details.
--    Rates live in settings because BIR revises them; a revision must not
--    require a migration, and historical invoices keep their own snapshot.
-- ────────────────────────────────────────────
INSERT INTO public.settings (setting_key, setting_value, description) VALUES
    ('COMPANY_TIN',              '',       'Our BIR Taxpayer Identification Number, shown on sales invoices and used on withholding tax certificates.'),
    ('COMPANY_REGISTERED_NAME',  '',       'Our BIR-registered business name, if different from COMPANY_NAME.'),
    ('EWT_RATE_GOODS',           '0.01',   'Expanded withholding tax rate on sales of goods (decimal fraction).'),
    ('EWT_RATE_SERVICES',        '0.02',   'Expanded withholding tax rate on sales of services (decimal fraction).'),
    ('EWT_ATC_GOODS',            'WC158',  'BIR Alphanumeric Tax Code for EWT on goods.'),
    ('EWT_ATC_SERVICES',         'WC160',  'BIR Alphanumeric Tax Code for EWT on services.'),
    ('WITHHOLDING_VAT_RATE_GOV', '0.05',   'VAT withheld by government buyers (decimal fraction).'),
    ('WITHHOLDING_VAT_ATC_GOV',  'WV010',  'BIR Alphanumeric Tax Code for VAT withheld on government sales.')
ON CONFLICT (setting_key) DO NOTHING;

-- ────────────────────────────────────────────
-- 3. Settlement instrument.
--    payment_status stays 'settled': the credit is realised the moment the
--    customer withholds, so no new status value is introduced (the existing
--    chk_payment_status constraint permits only settled/pending/on_account).
-- ────────────────────────────────────────────
INSERT INTO public.payment_methods (code, name, type, config, enabled)
SELECT 'withholding_tax',
       'Tax Withheld at Source (BIR 2307/2306)',
       'other',
       '{"change_allowed": false, "max_split_count": null, "reference_label": "Certificate No.", "settlement_type": "instant", "requires_reference": false, "requires_receipt_no": false}'::jsonb,
       TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.payment_methods WHERE code = 'withholding_tax');

-- Mirrors CREDIT_MEMO_APPLIED: a negative entry that settles receivable without
-- cash. Added here but not used until this transaction commits, which Postgres
-- requires for a newly added enum label.
ALTER TYPE public.ar_ledger_entry_type ADD VALUE IF NOT EXISTS 'WITHHOLDING_TAX_CREDIT';

-- ────────────────────────────────────────────
-- 4. The withholding itself, recorded per invoice at the moment of collection.
--    This exists separately from the certificate because the paper arrives weeks
--    or months later -- usually at quarter end. The receivable must close now,
--    while the certificate stays outstanding and chaseable: an unclaimed 2307 is
--    money lost, since it can no longer be credited against income tax.
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.withholding_tax_line (
    wt_line_id          SERIAL PRIMARY KEY,
    invoice_id          INTEGER NOT NULL REFERENCES public.invoice(invoice_id) ON DELETE CASCADE,
    customer_id         INTEGER NOT NULL REFERENCES public.customer(customer_id) ON DELETE RESTRICT,
    -- The invoice_payments row that settled this amount, so the AR trail and the
    -- tax trail can always be reconciled against each other.
    payment_id          INTEGER REFERENCES public.invoice_payments(payment_id) ON DELETE SET NULL,

    withholding_type    VARCHAR(20) NOT NULL,   -- EWT_GOODS | EWT_SERVICES | VAT_GOV
    treatment           VARCHAR(30) NOT NULL,   -- INCOME_TAX_CREDITABLE | VAT_CREDITABLE | VAT_FINAL
    atc_code            VARCHAR(10),
    -- Snapshot, for the same reason invoice_line keeps tax_rate_snapshot: rates
    -- change, and an old invoice must stay reproducible.
    rate_snapshot       NUMERIC(6,4) NOT NULL,

    tax_base            NUMERIC(14,2) NOT NULL,
    -- What we computed versus what the customer actually deducted. These differ
    -- routinely -- most often because the customer withheld on the VAT-inclusive
    -- total instead of the net. AR always settles on the actual; the variance is
    -- a reconciliation matter, since we can only claim what the certificate says.
    expected_withheld   NUMERIC(14,2) NOT NULL,
    actual_withheld     NUMERIC(14,2) NOT NULL,

    certificate_id      INTEGER,                -- NULL until the paper arrives
    notes               TEXT,
    created_by          INTEGER REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_wt_line_type') THEN
        ALTER TABLE public.withholding_tax_line ADD CONSTRAINT chk_wt_line_type
            CHECK (withholding_type IN ('EWT_GOODS', 'EWT_SERVICES', 'VAT_GOV'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_wt_line_treatment') THEN
        ALTER TABLE public.withholding_tax_line ADD CONSTRAINT chk_wt_line_treatment
            CHECK (treatment IN ('INCOME_TAX_CREDITABLE', 'VAT_CREDITABLE', 'VAT_FINAL'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_wt_line_amounts_non_negative') THEN
        ALTER TABLE public.withholding_tax_line ADD CONSTRAINT chk_wt_line_amounts_non_negative
            CHECK (tax_base >= 0 AND expected_withheld >= 0 AND actual_withheld >= 0);
    END IF;
END $$;

-- ────────────────────────────────────────────
-- 5. The certificate. Created when the physical form is received, then the
--    outstanding lines above are allocated to it -- one certificate routinely
--    covers a whole quarter of invoices, which is why this is not a column on
--    the invoice.
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.withholding_tax_certificate (
    certificate_id        SERIAL PRIMARY KEY,
    customer_id           INTEGER NOT NULL REFERENCES public.customer(customer_id) ON DELETE RESTRICT,
    certificate_type      VARCHAR(10) NOT NULL,   -- 2307 | 2306
    certificate_no        VARCHAR(50),

    -- Snapshot of the payor as printed on the certificate. Kept verbatim because
    -- this is what BIR matches on; the customer record may be edited later.
    payor_tin             VARCHAR(20),
    payor_registered_name VARCHAR(255),

    period_from           DATE,
    period_to             DATE,
    date_received         DATE,

    tax_base_total        NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_withheld_total    NUMERIC(14,2) NOT NULL DEFAULT 0,

    status                VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
    attachment_path       TEXT,
    notes                 TEXT,
    created_by            INTEGER REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_wt_cert_type') THEN
        ALTER TABLE public.withholding_tax_certificate ADD CONSTRAINT chk_wt_cert_type
            CHECK (certificate_type IN ('2307', '2306'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_wt_cert_status') THEN
        ALTER TABLE public.withholding_tax_certificate ADD CONSTRAINT chk_wt_cert_status
            CHECK (status IN ('RECEIVED', 'CLAIMED', 'CANCELLED'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_wt_line_certificate') THEN
        ALTER TABLE public.withholding_tax_line ADD CONSTRAINT fk_wt_line_certificate
            FOREIGN KEY (certificate_id) REFERENCES public.withholding_tax_certificate(certificate_id) ON DELETE SET NULL;
    END IF;
END $$;

-- The same certificate number must not be recorded twice for one payor.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wt_certificate_no_per_customer
    ON public.withholding_tax_certificate (customer_id, certificate_no)
    WHERE certificate_no IS NOT NULL AND status <> 'CANCELLED';

-- Drives the chase list: withheld amounts with no certificate against them yet.
CREATE INDEX IF NOT EXISTS idx_wt_line_awaiting_certificate
    ON public.withholding_tax_line (customer_id, created_at) WHERE certificate_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_wt_line_invoice ON public.withholding_tax_line (invoice_id);
CREATE INDEX IF NOT EXISTS idx_wt_line_certificate ON public.withholding_tax_line (certificate_id);
CREATE INDEX IF NOT EXISTS idx_wt_cert_customer ON public.withholding_tax_certificate (customer_id, date_received DESC);

-- ────────────────────────────────────────────
-- 6. Permissions. Recording withholding at the counter is part of collecting
--    payment; managing certificates is a bookkeeping task.
-- ────────────────────────────────────────────
INSERT INTO public.permission (permission_key, description, category) VALUES
    ('withholding_tax:manage', 'Record tax withheld at source and manage BIR 2307/2306 certificates', 'Finance')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT lvl, p.permission_id
FROM public.permission p
CROSS JOIN (VALUES (5), (7), (10)) AS t(lvl)
WHERE p.permission_key = 'withholding_tax:manage'
ON CONFLICT (permission_level_id, permission_id) DO NOTHING;

COMMIT;
