-- Correct & Restart Sale: durable, auditable correction cases.
-- This migration deliberately does not alter historical invoices or credit notes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.sales_correction_case (
    correction_case_id          bigserial PRIMARY KEY,
    original_invoice_id         integer NOT NULL UNIQUE REFERENCES public.invoice(invoice_id) ON DELETE RESTRICT,
    replacement_invoice_id      integer UNIQUE REFERENCES public.invoice(invoice_id) ON DELETE RESTRICT,
    requested_by                integer NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
    approved_by                 integer REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
    reason_code                 varchar(80) NOT NULL,
    reason_text                 text NOT NULL,
    state                       varchar(32) NOT NULL DEFAULT 'DRAFT',
    financial_resolution        varchar(48) NOT NULL,
    resolution_evidence         jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key             uuid NOT NULL DEFAULT gen_random_uuid(),
    requested_at                timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at                 timestamptz,
    executed_at                 timestamptz,
    completed_at                timestamptz,
    failure_reason              text,
    CONSTRAINT chk_sales_correction_state CHECK (state IN (
        'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTING',
        'COMPLETED', 'REJECTED', 'FAILED', 'REQUIRES_MANUAL_REVIEW'
    )),
    CONSTRAINT chk_sales_correction_resolution CHECK (financial_resolution IN (
        'CANCEL_ONLY', 'REVERSE_PAYMENT_AND_CANCEL',
        'REFUND_NOT_RELEASED_AND_CANCEL', 'RECOVER_REFUND_AND_RESTART',
        'INDEPENDENT_REPLACEMENT', 'MANUAL_REVIEW'
    )),
    CONSTRAINT chk_sales_correction_reason_text CHECK (length(btrim(reason_text)) >= 5),
    CONSTRAINT uq_sales_correction_idempotency UNIQUE (idempotency_key),
    CONSTRAINT chk_sales_correction_approval CHECK (
        (state IN ('APPROVED', 'EXECUTING', 'COMPLETED') AND approved_by IS NOT NULL)
        OR state NOT IN ('APPROVED', 'EXECUTING', 'COMPLETED')
    )
);

CREATE TABLE IF NOT EXISTS public.sales_correction_event (
    correction_event_id         bigserial PRIMARY KEY,
    correction_case_id          bigint NOT NULL REFERENCES public.sales_correction_case(correction_case_id) ON DELETE RESTRICT,
    event_type                  varchar(48) NOT NULL,
    event_data                  jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at                  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by                  integer REFERENCES public.employee(employee_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_correction_case_state
    ON public.sales_correction_case (state, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_correction_event_case
    ON public.sales_correction_event (correction_case_id, correction_event_id);

CREATE OR REPLACE FUNCTION public.sales_correction_case_audit_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.sales_correction_event (correction_case_id, event_type, event_data, created_by)
        VALUES (NEW.correction_case_id, 'CASE_CREATED', jsonb_build_object('state', NEW.state, 'resolution', NEW.financial_resolution), NEW.requested_by);
    ELSIF NEW.state IS DISTINCT FROM OLD.state THEN
        INSERT INTO public.sales_correction_event (correction_case_id, event_type, event_data, created_by)
        VALUES (NEW.correction_case_id, 'STATE_CHANGED', jsonb_build_object('from', OLD.state, 'to', NEW.state), COALESCE(NEW.approved_by, NEW.requested_by));
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_correction_case_audit ON public.sales_correction_case;
CREATE TRIGGER trg_sales_correction_case_audit
    AFTER INSERT OR UPDATE OF state ON public.sales_correction_case
    FOR EACH ROW EXECUTE FUNCTION public.sales_correction_case_audit_event();

INSERT INTO public.permission (permission_key, description, category) VALUES
    ('sales_correction:create', 'Request Correct & Restart Sale cases', 'Sales & A/R'),
    ('sales_correction:approve', 'Approve and execute Correct & Restart Sale cases', 'Sales & A/R'),
    ('sales_correction:view', 'View Correct & Restart Sale cases', 'Sales & A/R')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM (VALUES (10), (7)) AS pl(permission_level_id)
JOIN public.permission p ON p.permission_key IN ('sales_correction:create', 'sales_correction:approve', 'sales_correction:view')
ON CONFLICT (permission_level_id, permission_id) DO NOTHING;

INSERT INTO public.settings (setting_key, setting_value, description) VALUES
    ('ENABLE_SALES_CORRECTIONS', 'false', 'Enable the Correct & Restart Sale workflow after accounting rollout approval.')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
