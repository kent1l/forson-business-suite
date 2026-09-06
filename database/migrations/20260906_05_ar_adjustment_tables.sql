-- Migration: 20260906_05_ar_adjustment_tables.sql
-- Description: Post-invoice A/R concessions as a first-class document.
--
-- A trade customer owes 12,800. The owner takes 12,000 in cash and forgives 800
-- to close the account. Until now the only ways to record that were all wrong:
--
--   * Ring the 800 up as cash -- inflates the day's collections, and since there
--     is no till or shift module, the collections figure in ar_ledger IS the cash
--     control. Nothing else would catch it.
--   * Issue a credit note -- credit_note is refund-shaped. It carries
--     credit_note_line rows keyed on part_id, writes inventory_transaction rows
--     with trans_type = 'Refund', and has a tax breakdown. Using it for a cash
--     concession returns phantom stock and adjusts output VAT.
--   * Post a free-text CREDIT_ADJUSTMENT via POST /ar/ledger/:id/adjustment --
--     moves the customer balance but touches no invoice, so the invoice sits at
--     'Partially Paid' with 800 due forever while the customer balance says zero.
--
-- What this table is instead: a numbered document that names the invoices it
-- forgives, carries a mandatory reason, records who granted it and who (if
-- anyone) authorized them, and posts one credit entry to the immutable ledger.
-- It is never a payment method and never appears in a tender list -- a concession
-- is not money received, and no cash report should be able to mistake it for any.
--
-- TAX: no output-VAT adjustment. A discount granted after invoicing is contingent
-- on a future event (the customer settling), so under RR 16-2005 it is not
-- deductible from the VAT base. The sale stays 12,800 for VAT and for revenue;
-- only its collectability changed. That is why this deliberately does NOT reuse
-- credit_note, and why reason codes carry a gl_treatment tag instead: FBS has no
-- general ledger, so the bookkeeper posts these from a report.

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1. Reason codes. A row rather than a CHECK constraint so the owner can retire
--    one or add their own from Admin Settings without a migration -- the same
--    call taken for payment_methods and tax rates.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ar_adjustment_reason (
    reason_code    varchar(40)   PRIMARY KEY,
    label          varchar(100)  NOT NULL,
    description    text,
    applies_to     varchar(20)   NOT NULL DEFAULT 'BOTH',
    gl_treatment   varchar(30)   NOT NULL,
    -- A cap the reason itself carries. ROUNDING is seeded at 1.00 so the centavo
    -- bucket can never quietly absorb a real concession.
    max_amount     numeric(12,2),
    requires_note  boolean       NOT NULL DEFAULT false,
    is_active      boolean       NOT NULL DEFAULT true,
    sort_order     integer       NOT NULL DEFAULT 0,
    CONSTRAINT chk_ar_reason_applies_to  CHECK (applies_to   IN ('SETTLEMENT', 'WRITE_DOWN', 'BOTH')),
    CONSTRAINT chk_ar_reason_gl          CHECK (gl_treatment IN ('CONTRA_REVENUE', 'BAD_DEBT_EXPENSE')),
    CONSTRAINT chk_ar_reason_max_amount  CHECK (max_amount IS NULL OR max_amount > 0)
);

COMMENT ON COLUMN public.ar_adjustment_reason.gl_treatment IS
    'Which account the bookkeeper posts this to. FBS keeps no general ledger, so this tags the concession for GET /ar/adjustments/summary rather than driving a journal entry.';

INSERT INTO public.ar_adjustment_reason
    (reason_code, label, description, applies_to, gl_treatment, max_amount, requires_note, sort_order)
VALUES
    ('PROMPT_SETTLEMENT', 'Prompt Settlement Discount',
     'Agreed concession for settling an outstanding balance immediately.',
     'SETTLEMENT', 'CONTRA_REVENUE',  NULL, false, 10),
    ('ROUNDING', 'Rounding / Centavo Adjustment',
     'Clears a trivial residue so an invoice can close.',
     'BOTH', 'CONTRA_REVENUE', 1.00, false, 20),
    ('DISPUTE_CONCESSION', 'Dispute Concession',
     'Settlement of a disputed price, quantity, or quality claim.',
     'BOTH', 'CONTRA_REVENUE', NULL, true, 30),
    ('PRICE_CORRECTION', 'Billing Error Correction',
     'Corrects an amount billed in error where the goods were not returned.',
     'BOTH', 'CONTRA_REVENUE', NULL, true, 40),
    ('GOODWILL', 'Commercial Goodwill',
     'Discretionary concession to retain a trade account.',
     'BOTH', 'CONTRA_REVENUE', NULL, true, 50),
    ('BAD_DEBT_WRITE_OFF', 'Bad Debt Write-Off',
     'Balance judged uncollectible and written off.',
     'WRITE_DOWN', 'BAD_DEBT_EXPENSE', NULL, true, 60)
ON CONFLICT (reason_code) DO NOTHING;

-- ────────────────────────────────────────────────────────────────
-- 2. The document.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ar_adjustment (
    adjustment_id       bigserial     PRIMARY KEY,
    adjustment_no       varchar(50)   NOT NULL UNIQUE,   -- ADJ-YYYYMM-0001
    customer_id         integer       NOT NULL REFERENCES public.customer(customer_id) ON DELETE RESTRICT,
    adjustment_type     varchar(30)   NOT NULL,
    reason_code         varchar(40)   NOT NULL REFERENCES public.ar_adjustment_reason(reason_code) ON DELETE RESTRICT,
    total_amount        numeric(12,2) NOT NULL,
    notes               text,
    status              varchar(20)   NOT NULL DEFAULT 'POSTED',

    -- Which collection this concession was granted alongside, if any. An A/R
    -- receipt is a customer_payment; a tender taken at the POS is an
    -- invoice_payments row. Both exist, so both are addressable.
    customer_payment_id integer       REFERENCES public.customer_payment(payment_id) ON DELETE SET NULL,
    invoice_payment_id  integer       REFERENCES public.invoice_payments(payment_id)  ON DELETE SET NULL,

    -- The ar_ledger entry this document produced. The link runs this way round on
    -- purpose: adding a parameter to append_ar_ledger_entry() would create a
    -- second overload and break every existing caller with "function is not
    -- unique", which 20260816_05_fix_ledger_entry_function_overloads.sql already
    -- had to clean up once. NULL while PENDING_CLEARANCE.
    ledger_id           bigint        UNIQUE REFERENCES public.ar_ledger(ledger_id),

    granted_by          integer       NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
    -- NULL when granted_by held the permission themselves. Populated when someone
    -- without it had a permission-holder authorize them at the counter.
    authorized_by       integer       REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
    authorization_method varchar(20)  NOT NULL DEFAULT 'SELF',

    -- Idempotency for a retried POST, following the precedent in
    -- 20260817_05_inventory_adjustment_client_ref.sql.
    client_ref          uuid          UNIQUE,

    -- Business date, distinct from created_at. Corrected later only through
    -- transactionDateService, exactly as ar_ledger.entry_date is.
    entry_date          timestamptz   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at          timestamptz   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    reverses_adjustment_id bigint     REFERENCES public.ar_adjustment(adjustment_id) ON DELETE RESTRICT,
    reversed_at         timestamptz,
    reversal_reason     text,

    CONSTRAINT chk_ar_adjustment_type   CHECK (adjustment_type IN ('SETTLEMENT_DISCOUNT', 'BALANCE_WRITE_DOWN')),
    CONSTRAINT chk_ar_adjustment_status CHECK (status IN ('PENDING_CLEARANCE', 'POSTED', 'REVERSED', 'VOIDED')),
    CONSTRAINT chk_ar_adjustment_auth   CHECK (authorization_method IN ('SELF', 'ELEVATED')),
    CONSTRAINT chk_ar_adjustment_amount CHECK (total_amount > 0),
    -- An elevated grant without a named authorizer is unattributable, and a
    -- self-grant with one is a contradiction. Both are rejected outright.
    CONSTRAINT chk_ar_adjustment_authorizer CHECK (
        (authorization_method = 'ELEVATED' AND authorized_by IS NOT NULL)
     OR (authorization_method = 'SELF'     AND authorized_by IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_ar_adjustment_customer   ON public.ar_adjustment (customer_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_ar_adjustment_reason     ON public.ar_adjustment (reason_code);
CREATE INDEX IF NOT EXISTS idx_ar_adjustment_granted_by ON public.ar_adjustment (granted_by);
CREATE INDEX IF NOT EXISTS idx_ar_adjustment_authorized ON public.ar_adjustment (authorized_by) WHERE authorized_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ar_adjustment_cust_pmt   ON public.ar_adjustment (customer_payment_id) WHERE customer_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ar_adjustment_inv_pmt    ON public.ar_adjustment (invoice_payment_id)  WHERE invoice_payment_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ar_adjustment_pending    ON public.ar_adjustment (status) WHERE status = 'PENDING_CLEARANCE';

-- ────────────────────────────────────────────────────────────────
-- 3. What it forgives. Every peso lands on a named invoice -- an unallocated
--    concession is precisely the broken CREDIT_ADJUSTMENT this replaces.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ar_adjustment_allocation (
    allocation_id  bigserial     PRIMARY KEY,
    adjustment_id  bigint        NOT NULL REFERENCES public.ar_adjustment(adjustment_id) ON DELETE RESTRICT,
    invoice_id     integer       NOT NULL REFERENCES public.invoice(invoice_id) ON DELETE RESTRICT,
    amount         numeric(12,2) NOT NULL,
    CONSTRAINT chk_ar_adjustment_alloc_amount CHECK (amount > 0),
    CONSTRAINT uq_ar_adjustment_alloc UNIQUE (adjustment_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_ar_adjustment_alloc_invoice ON public.ar_adjustment_allocation (invoice_id);

-- ────────────────────────────────────────────────────────────────
-- 4. Authorization trail. Shaped after wac_correction_audit_log.
--    Denied attempts are recorded too, and adjustment_id is nullable for exactly
--    that reason: a cashier repeatedly failing to find someone to authorize a
--    concession is the signal worth having, and it produces no document.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ar_adjustment_authorization_log (
    log_id         bigserial     PRIMARY KEY,
    adjustment_id  bigint        REFERENCES public.ar_adjustment(adjustment_id) ON DELETE SET NULL,
    customer_id    integer       REFERENCES public.customer(customer_id) ON DELETE SET NULL,
    action         varchar(20)   NOT NULL,
    requested_by   integer       NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
    authorized_by  integer       REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
    amount         numeric(12,2),
    reason_code    varchar(40),
    token_jti      varchar(64),
    notes          text,
    created_at     timestamptz   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_ar_auth_log_action CHECK (action IN ('AUTHORIZED', 'DENIED', 'REVERSED'))
);

CREATE INDEX IF NOT EXISTS idx_ar_auth_log_requested ON public.ar_adjustment_authorization_log (requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ar_auth_log_denied    ON public.ar_adjustment_authorization_log (created_at DESC) WHERE action = 'DENIED';
-- A token may be spent once. Enforced here rather than in the service so a
-- replayed request loses the race in the database, not in JavaScript.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_auth_log_jti ON public.ar_adjustment_authorization_log (token_jti)
    WHERE token_jti IS NOT NULL AND action = 'AUTHORIZED';

-- ────────────────────────────────────────────────────────────────
-- 5. Effective immutability. A concession is money forgiven; correcting one
--    means posting a reversal, not editing the original. Mirrors the intent of
--    ar_ledger_immutability_guard(), but has to be selective: the status column
--    legitimately advances, and posting fills in ledger_id.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ar_adjustment_immutability_guard()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'ar_adjustment rows cannot be deleted — reverse the adjustment instead';
    END IF;

    IF NEW.adjustment_no          IS DISTINCT FROM OLD.adjustment_no
    OR NEW.customer_id            IS DISTINCT FROM OLD.customer_id
    OR NEW.adjustment_type        IS DISTINCT FROM OLD.adjustment_type
    OR NEW.reason_code            IS DISTINCT FROM OLD.reason_code
    OR NEW.total_amount           IS DISTINCT FROM OLD.total_amount
    OR NEW.granted_by             IS DISTINCT FROM OLD.granted_by
    OR NEW.authorized_by          IS DISTINCT FROM OLD.authorized_by
    OR NEW.authorization_method   IS DISTINCT FROM OLD.authorization_method
    OR NEW.client_ref             IS DISTINCT FROM OLD.client_ref
    OR NEW.created_at             IS DISTINCT FROM OLD.created_at
    OR NEW.reverses_adjustment_id IS DISTINCT FROM OLD.reverses_adjustment_id THEN
        RAISE EXCEPTION 'ar_adjustment % is immutable — post a reversing adjustment instead of editing it', OLD.adjustment_no;
    END IF;

    -- ledger_id is written once, when the document posts.
    IF OLD.ledger_id IS NOT NULL AND NEW.ledger_id IS DISTINCT FROM OLD.ledger_id THEN
        RAISE EXCEPTION 'ar_adjustment % is already linked to ledger entry % ', OLD.adjustment_no, OLD.ledger_id;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (
            (OLD.status = 'PENDING_CLEARANCE' AND NEW.status IN ('POSTED', 'VOIDED'))
         OR (OLD.status = 'POSTED'            AND NEW.status = 'REVERSED')
        ) THEN
            RAISE EXCEPTION 'ar_adjustment % cannot move from % to %', OLD.adjustment_no, OLD.status, NEW.status;
        END IF;
    END IF;

    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ar_adjustment_immutable ON public.ar_adjustment;
CREATE TRIGGER trg_ar_adjustment_immutable
    BEFORE UPDATE OR DELETE ON public.ar_adjustment
    FOR EACH ROW EXECUTE FUNCTION public.ar_adjustment_immutability_guard();

-- Allocations are part of the document, so they are equally fixed.
CREATE OR REPLACE FUNCTION public.ar_adjustment_allocation_guard()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    RAISE EXCEPTION 'ar_adjustment_allocation rows are immutable — reverse the adjustment instead';
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ar_adjustment_alloc_immutable ON public.ar_adjustment_allocation;
CREATE TRIGGER trg_ar_adjustment_alloc_immutable
    BEFORE UPDATE OR DELETE ON public.ar_adjustment_allocation
    FOR EACH ROW EXECUTE FUNCTION public.ar_adjustment_allocation_guard();

-- ────────────────────────────────────────────────────────────────
-- 6. Allocations must add up to the document. DEFERRABLE so a service can insert
--    the header and its lines in any order within one transaction; the check
--    lands at COMMIT.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ar_adjustment_allocation_balance_check()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
    v_adjustment_id bigint;
    v_total         numeric(12,2);
    v_allocated     numeric(12,2);
    v_status        varchar(20);
    v_no            varchar(50);
BEGIN
    v_adjustment_id := CASE WHEN TG_TABLE_NAME = 'ar_adjustment'
                            THEN NEW.adjustment_id
                            ELSE COALESCE(NEW.adjustment_id, OLD.adjustment_id) END;

    SELECT total_amount, status, adjustment_no
      INTO v_total, v_status, v_no
      FROM public.ar_adjustment WHERE adjustment_id = v_adjustment_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- A cheque-backed concession has no allocations until the cheque clears, and
    -- a voided one has had them removed with it. Neither should be balanced.
    IF v_status IN ('PENDING_CLEARANCE', 'VOIDED') THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_allocated
      FROM public.ar_adjustment_allocation WHERE adjustment_id = v_adjustment_id;

    IF ABS(v_allocated - v_total) > 0.005 THEN
        RAISE EXCEPTION 'Adjustment % is for % but allocates % across invoices — every peso of a concession must land on a named invoice',
            v_no, v_total, v_allocated;
    END IF;

    RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ar_adjustment_alloc_balanced ON public.ar_adjustment_allocation;
CREATE CONSTRAINT TRIGGER trg_ar_adjustment_alloc_balanced
    AFTER INSERT OR UPDATE OR DELETE ON public.ar_adjustment_allocation
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION public.ar_adjustment_allocation_balance_check();

DROP TRIGGER IF EXISTS trg_ar_adjustment_balanced ON public.ar_adjustment;
CREATE CONSTRAINT TRIGGER trg_ar_adjustment_balanced
    AFTER INSERT OR UPDATE ON public.ar_adjustment
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION public.ar_adjustment_allocation_balance_check();

-- ────────────────────────────────────────────────────────────────
-- 7. Settlement now includes concessions.
--    Same shape as 20260906_03, with the adjustment term added. Only POSTED
--    documents count: PENDING_CLEARANCE is waiting on a cheque, REVERSED and
--    VOIDED never happened as far as the invoice is concerned.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_invoice_settlement(p_invoice_id integer)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
    v_total     numeric(12,2);
    v_status    varchar(20);
    v_settled   numeric(12,2);
    v_refunded  numeric(12,2);
    v_net       numeric(12,2);
BEGIN
    SELECT total_amount, status
      INTO v_total, v_status
      FROM public.invoice
     WHERE invoice_id = p_invoice_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT COALESCE((SELECT SUM(amount_paid)
                       FROM public.invoice_payments
                      WHERE invoice_id = p_invoice_id
                        AND payment_status = 'settled'), 0)
         + COALESCE((SELECT SUM(ipa.amount_allocated)
                       FROM public.invoice_payment_allocation ipa
                       JOIN public.customer_payment cp ON cp.payment_id = ipa.payment_id
                      WHERE ipa.invoice_id = p_invoice_id
                        AND cp.pdc_status IS DISTINCT FROM 'BOUNCED'), 0)
         + COALESCE((SELECT SUM(aa.amount)
                       FROM public.ar_adjustment_allocation aa
                       JOIN public.ar_adjustment adj ON adj.adjustment_id = aa.adjustment_id
                      WHERE aa.invoice_id = p_invoice_id
                        AND adj.status = 'POSTED'), 0)
      INTO v_settled;

    SELECT COALESCE(SUM(total_amount), 0)
      INTO v_refunded
      FROM public.credit_note
     WHERE invoice_id = p_invoice_id;

    v_net := GREATEST(v_total - v_refunded, 0);

    UPDATE public.invoice
       SET amount_paid = v_settled,
           status = CASE
               WHEN v_status IN ('Cancelled', 'Written Off')  THEN v_status
               WHEN v_refunded >= v_total                     THEN 'Fully Refunded'
               WHEN v_net > 0 AND v_settled >= v_net          THEN 'Paid'
               WHEN v_settled > 0                             THEN 'Partially Paid'
               ELSE 'Unpaid'
           END
     WHERE invoice_id = p_invoice_id;
END;
$fn$;

-- Allocation changes and status transitions both move the invoice.
CREATE OR REPLACE FUNCTION public.ar_adjustment_recompute_invoices()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
    v_invoice_id integer;
BEGIN
    IF TG_TABLE_NAME = 'ar_adjustment_allocation' THEN
        PERFORM public.recompute_invoice_settlement(NEW.invoice_id);
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        FOR v_invoice_id IN
            SELECT invoice_id FROM public.ar_adjustment_allocation WHERE adjustment_id = NEW.adjustment_id
        LOOP
            PERFORM public.recompute_invoice_settlement(v_invoice_id);
        END LOOP;
    END IF;

    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ar_adjustment_alloc_recompute ON public.ar_adjustment_allocation;
CREATE TRIGGER trg_ar_adjustment_alloc_recompute
    AFTER INSERT ON public.ar_adjustment_allocation
    FOR EACH ROW EXECUTE FUNCTION public.ar_adjustment_recompute_invoices();

DROP TRIGGER IF EXISTS trg_ar_adjustment_status_recompute ON public.ar_adjustment;
CREATE TRIGGER trg_ar_adjustment_status_recompute
    AFTER UPDATE OF status ON public.ar_adjustment
    FOR EACH ROW EXECUTE FUNCTION public.ar_adjustment_recompute_invoices();

COMMIT;
