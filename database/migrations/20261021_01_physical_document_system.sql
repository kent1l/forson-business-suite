-- Migration: 20261021_01_physical_document_system.sql
-- Description: Physical document series, registry, source links, selection policies, last success state, and audit events.

-- 1. Document Types
CREATE TABLE IF NOT EXISTS public.physical_document_type (
    type_id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    short_label VARCHAR(20) NOT NULL,
    controlled_category VARCHAR(50) NOT NULL,
    tax_designation VARCHAR(20) NOT NULL,
    default_method VARCHAR(30) NOT NULL DEFAULT 'HIGHEST_PLUS_ONE',
    is_active BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by INT REFERENCES public.employee(employee_id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INT REFERENCES public.employee(employee_id),
    CONSTRAINT chk_physical_doc_type_method CHECK (default_method IN ('HIGHEST_PLUS_ONE', 'LAST_ISSUED_PLUS_ONE', 'NONE')),
    CONSTRAINT chk_physical_doc_type_tax CHECK (tax_designation IN ('NON_VAT', 'VAT', 'EXEMPT', 'NOT_APPLICABLE')),
    CONSTRAINT chk_physical_doc_type_cat CHECK (controlled_category IN ('SALES_INVOICE', 'CHARGE_INVOICE', 'DELIVERY_RECEIPT', 'COLLECTION_RECEIPT', 'NOTEBOOK'))
);

-- 2. Document Series
CREATE TABLE IF NOT EXISTS public.physical_document_series (
    series_id SERIAL PRIMARY KEY,
    type_id INT NOT NULL REFERENCES public.physical_document_type(type_id),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    prefix VARCHAR(10) NOT NULL,
    method VARCHAR(30) NOT NULL DEFAULT 'HIGHEST_PLUS_ONE',
    initial_serial BIGINT NOT NULL DEFAULT 1,
    min_serial BIGINT,
    max_serial BIGINT,
    high_water_serial BIGINT,
    last_issued_serial BIGINT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by INT REFERENCES public.employee(employee_id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INT REFERENCES public.employee(employee_id),
    CONSTRAINT chk_physical_doc_series_method CHECK (method IN ('HIGHEST_PLUS_ONE', 'LAST_ISSUED_PLUS_ONE', 'NONE')),
    CONSTRAINT chk_physical_doc_series_init CHECK (initial_serial > 0),
    CONSTRAINT chk_physical_doc_series_bounds CHECK (
        (min_serial IS NULL OR min_serial > 0) AND
        (max_serial IS NULL OR (min_serial IS NOT NULL AND max_serial >= min_serial))
    )
);

-- 3. Series Context Eligibility
CREATE TABLE IF NOT EXISTS public.physical_document_series_context (
    id SERIAL PRIMARY KEY,
    series_id INT NOT NULL REFERENCES public.physical_document_series(series_id) ON DELETE CASCADE,
    context VARCHAR(50) NOT NULL,
    workstation_id VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_physical_doc_context CHECK (context IN ('POS', 'INVOICING', 'CASHIER_APPROVAL', 'COLLECTION'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_series_context_workstation
    ON public.physical_document_series_context (series_id, context, COALESCE(workstation_id, ''));

-- 4. Series Tax Configuration
CREATE TABLE IF NOT EXISTS public.physical_document_series_tax (
    id SERIAL PRIMARY KEY,
    series_id INT NOT NULL REFERENCES public.physical_document_series(series_id) ON DELETE CASCADE,
    tax_rate_id INT NOT NULL REFERENCES public.tax_rate(tax_rate_id),
    role VARCHAR(30) NOT NULL DEFAULT 'ALLOWED_RESOLVED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (series_id, tax_rate_id),
    CONSTRAINT chk_series_tax_role CHECK (role IN ('DEFAULT_FALLBACK', 'ALLOWED_RESOLVED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_series_tax_fallback
    ON public.physical_document_series_tax (series_id)
    WHERE role = 'DEFAULT_FALLBACK';

-- 5. Selection Policy
CREATE TABLE IF NOT EXISTS public.physical_document_selection_policy (
    id SERIAL PRIMARY KEY,
    context VARCHAR(50) NOT NULL,
    workstation_id VARCHAR(100),
    mode VARCHAR(30) NOT NULL DEFAULT 'LAST_SUCCESSFUL',
    fixed_or_fallback_series_id INT REFERENCES public.physical_document_series(series_id) ON DELETE SET NULL,
    allow_notebook BOOLEAN NOT NULL DEFAULT true,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INT REFERENCES public.employee(employee_id),
    CONSTRAINT chk_policy_mode CHECK (mode IN ('FIXED_DEFAULT', 'LAST_SUCCESSFUL', 'ALWAYS_ASK')),
    CONSTRAINT chk_policy_fixed_requires_series CHECK (mode != 'FIXED_DEFAULT' OR fixed_or_fallback_series_id IS NOT NULL),
    CONSTRAINT chk_policy_context CHECK (context IN ('POS', 'INVOICING', 'CASHIER_APPROVAL', 'COLLECTION'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_policy_context_workstation
    ON public.physical_document_selection_policy (context, COALESCE(workstation_id, ''));

-- 6. Last Successful Issued Series (per employee, workstation, context)
CREATE TABLE IF NOT EXISTS public.physical_document_last_success (
    id SERIAL PRIMARY KEY,
    employee_id INT NOT NULL REFERENCES public.employee(employee_id),
    workstation_id VARCHAR(100) NOT NULL DEFAULT 'default',
    context VARCHAR(50) NOT NULL,
    last_series_id INT NOT NULL REFERENCES public.physical_document_series(series_id),
    last_issuance_id VARCHAR(100),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (employee_id, workstation_id, context),
    CONSTRAINT chk_last_success_context CHECK (context IN ('POS', 'INVOICING', 'CASHIER_APPROVAL', 'COLLECTION'))
);

-- 7. Registry
CREATE TABLE IF NOT EXISTS public.physical_document_registry (
    registry_id SERIAL PRIMARY KEY,
    series_id INT NOT NULL REFERENCES public.physical_document_series(series_id),
    canonical_full_reference VARCHAR(50) NOT NULL,
    serial_number BIGINT NOT NULL,
    state VARCHAR(30) NOT NULL DEFAULT 'ISSUED',
    request_id VARCHAR(100),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by INT REFERENCES public.employee(employee_id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INT REFERENCES public.employee(employee_id),
    CONSTRAINT chk_registry_state CHECK (state IN ('ISSUED', 'VOIDED', 'SPOILED', 'UNOCCUPIED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_physical_doc_registry_occupied
    ON public.physical_document_registry (series_id, canonical_full_reference)
    WHERE state IN ('ISSUED', 'VOIDED', 'SPOILED');
CREATE INDEX IF NOT EXISTS idx_physical_doc_registry_serial
    ON public.physical_document_registry (series_id, serial_number, state);

-- 8. Customer Payment Collection Group (for grouping multiple tenders under one collection receipt)
CREATE TABLE IF NOT EXISTS public.customer_payment_collection_group (
    group_id SERIAL PRIMARY KEY,
    group_reference VARCHAR(50) NOT NULL UNIQUE,
    customer_id INT NOT NULL REFERENCES public.customer(customer_id),
    created_by INT NOT NULL REFERENCES public.employee(employee_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    request_id VARCHAR(100) UNIQUE,
    recording_method VARCHAR(20) NOT NULL DEFAULT 'PAPER',
    physical_document_type_id INT REFERENCES public.physical_document_type(type_id),
    physical_document_series_id INT REFERENCES public.physical_document_series(series_id),
    physical_document_registry_id INT REFERENCES public.physical_document_registry(registry_id),
    physical_receipt_no VARCHAR(50),
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    notes TEXT,
    CONSTRAINT chk_coll_group_rec_method CHECK (recording_method IN ('PAPER', 'NOTEBOOK'))
);

-- 9. Source Links
CREATE TABLE IF NOT EXISTS public.physical_document_source_link (
    link_id SERIAL PRIMARY KEY,
    registry_id INT NOT NULL REFERENCES public.physical_document_registry(registry_id),
    source_type VARCHAR(30) NOT NULL,
    invoice_id INT REFERENCES public.invoice(invoice_id),
    payment_id INT REFERENCES public.customer_payment(payment_id),
    collection_group_id INT REFERENCES public.customer_payment_collection_group(group_id),
    role VARCHAR(30) NOT NULL DEFAULT 'PRIMARY',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_source_link_type CHECK (source_type IN ('INVOICE', 'CUSTOMER_PAYMENT', 'COLLECTION_GROUP')),
    CONSTRAINT chk_source_link_exactly_one CHECK (
        (invoice_id IS NOT NULL)::int + (payment_id IS NOT NULL)::int + (collection_group_id IS NOT NULL)::int = 1
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_link_invoice
    ON public.physical_document_source_link (invoice_id)
    WHERE invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_link_payment
    ON public.physical_document_source_link (payment_id)
    WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_link_group
    ON public.physical_document_source_link (collection_group_id)
    WHERE collection_group_id IS NOT NULL;

-- 10. Audit Events (append-only)
CREATE TABLE IF NOT EXISTS public.physical_document_event (
    event_id SERIAL PRIMARY KEY,
    series_id INT REFERENCES public.physical_document_series(series_id),
    registry_id INT REFERENCES public.physical_document_registry(registry_id),
    source_type VARCHAR(30),
    source_id INT,
    request_id VARCHAR(100),
    event_type VARCHAR(50) NOT NULL,
    original_suggestion VARCHAR(50),
    submitted_reference VARCHAR(50),
    reason VARCHAR(100),
    notes TEXT,
    before_state JSONB,
    after_state JSONB,
    actor_id INT REFERENCES public.employee(employee_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_physical_doc_event_series
    ON public.physical_document_event (series_id, created_at);

-- 11. Add columns to invoice and customer_payment
ALTER TABLE public.invoice
    ADD COLUMN IF NOT EXISTS recording_method VARCHAR(20) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS physical_document_type_id INT REFERENCES public.physical_document_type(type_id),
    ADD COLUMN IF NOT EXISTS physical_document_series_id INT REFERENCES public.physical_document_series(series_id),
    ADD COLUMN IF NOT EXISTS physical_document_registry_id INT REFERENCES public.physical_document_registry(registry_id);

ALTER TABLE public.customer_payment
    ADD COLUMN IF NOT EXISTS collection_group_id INT REFERENCES public.customer_payment_collection_group(group_id),
    ADD COLUMN IF NOT EXISTS recording_method VARCHAR(20) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS physical_document_type_id INT REFERENCES public.physical_document_type(type_id),
    ADD COLUMN IF NOT EXISTS physical_document_series_id INT REFERENCES public.physical_document_series(series_id),
    ADD COLUMN IF NOT EXISTS physical_document_registry_id INT REFERENCES public.physical_document_registry(registry_id);

-- 12. Cross-table Series Uniqueness Checker Function
CREATE OR REPLACE FUNCTION public.is_series_physical_receipt_no_taken(
    p_series_id INT,
    p_receipt_no TEXT,
    p_ignore_registry_id INT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_clean TEXT := UPPER(TRIM(p_receipt_no));
    v_taken BOOLEAN := FALSE;
BEGIN
    IF v_clean IS NULL OR v_clean = '' OR p_series_id IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.physical_document_registry
        WHERE series_id = p_series_id
          AND canonical_full_reference = v_clean
          AND state IN ('ISSUED', 'VOIDED', 'SPOILED')
          AND (p_ignore_registry_id IS NULL OR registry_id != p_ignore_registry_id)
    ) INTO v_taken;

    RETURN v_taken;
END;
$$ LANGUAGE plpgsql STABLE;

-- 13. Update legacy is_physical_receipt_no_taken to also inspect registry
CREATE OR REPLACE FUNCTION public.is_physical_receipt_no_taken(
    p_receipt_no TEXT,
    p_ignore_invoice_id INT DEFAULT NULL,
    p_ignore_payment_id INT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_clean TEXT := LOWER(TRIM(p_receipt_no));
    v_upper TEXT := UPPER(TRIM(p_receipt_no));
    v_count INT := 0;
BEGIN
    IF v_clean IS NULL OR v_clean = '' THEN
        RETURN FALSE;
    END IF;

    SELECT COUNT(*) INTO v_count FROM (
        SELECT invoice_id FROM public.invoice
        WHERE LOWER(TRIM(physical_receipt_no)) = v_clean
          AND (p_ignore_invoice_id IS NULL OR invoice_id != p_ignore_invoice_id)
        UNION ALL
        SELECT payment_id FROM public.customer_payment
        WHERE LOWER(TRIM(physical_receipt_no)) = v_clean
          AND (p_ignore_payment_id IS NULL OR payment_id != p_ignore_payment_id)
        UNION ALL
        SELECT staged_sale_id FROM public.staged_sale
        WHERE LOWER(TRIM(physical_receipt_no)) = v_clean
          AND status NOT IN ('REJECTED', 'CANCELLED')
        UNION ALL
        SELECT r.registry_id FROM public.physical_document_registry r
        LEFT JOIN public.physical_document_source_link sl ON sl.registry_id = r.registry_id
        WHERE r.canonical_full_reference = v_upper
          AND r.state IN ('ISSUED', 'VOIDED', 'SPOILED')
          AND (p_ignore_invoice_id IS NULL OR sl.invoice_id IS NULL OR sl.invoice_id != p_ignore_invoice_id)
          AND (p_ignore_payment_id IS NULL OR sl.payment_id IS NULL OR sl.payment_id != p_ignore_payment_id)
    ) t;

    RETURN v_count > 0;
END;
$$ LANGUAGE plpgsql STABLE;

-- 14. Seed Initial Document Types (inactive per section 8)
INSERT INTO public.physical_document_type (code, name, short_label, controlled_category, tax_designation, default_method, is_active)
VALUES
    ('SALES_INVOICE_NON_VAT', 'Sales Invoice — Non-VAT', 'SI Non-VAT', 'SALES_INVOICE', 'NON_VAT', 'HIGHEST_PLUS_ONE', false),
    ('CHARGE_INVOICE_NON_VAT', 'Charge Invoice — Non-VAT', 'CI Non-VAT', 'CHARGE_INVOICE', 'NON_VAT', 'HIGHEST_PLUS_ONE', false),
    ('SALES_INVOICE_VAT', 'Sales Invoice — VAT', 'SI VAT', 'SALES_INVOICE', 'VAT', 'HIGHEST_PLUS_ONE', false),
    ('CHARGE_INVOICE_VAT', 'Charge Invoice — VAT', 'CI VAT', 'CHARGE_INVOICE', 'VAT', 'HIGHEST_PLUS_ONE', false),
    ('DELIVERY_RECEIPT', 'Delivery Receipt', 'DR', 'DELIVERY_RECEIPT', 'NOT_APPLICABLE', 'LAST_ISSUED_PLUS_ONE', false),
    ('COLLECTION_RECEIPT', 'Collection Receipt', 'CR', 'COLLECTION_RECEIPT', 'NOT_APPLICABLE', 'LAST_ISSUED_PLUS_ONE', false),
    ('NOTEBOOK', 'Notebook — No physical receipt issued', 'Notebook', 'NOTEBOOK', 'NOT_APPLICABLE', 'NONE', false)
ON CONFLICT (code) DO NOTHING;
