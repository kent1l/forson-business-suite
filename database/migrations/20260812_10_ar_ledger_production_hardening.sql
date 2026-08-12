-- Migration: 20260812_10_ar_ledger_production_hardening.sql
-- Description: Structural fix for the AR ledger's recurring "silent gap" bug class.
--
-- Context: ar_ledger (20260802_03) requires every code path that changes
-- invoice_payments.payment_status to 'settled' to *remember* to call
-- arLedgerService.appendEntry() explicitly. That has already caused three
-- separate silent-drift incidents needing manual backfill migrations
-- (20260803_02, 20260808_01, 20260811_02) — most recently a live gap in the
-- settle endpoint and the POS staged-sale approval flow. A fourth, still-live
-- gap exists today in pdcService.js verifyPayment()'s legacy invoice_payments
-- branch, which flips payment_status to 'settled' without writing a ledger
-- entry at all.
--
-- Rather than continue to patch call sites one at a time, this migration makes
-- the database itself the source of truth for "a settled invoice_payments row
-- always has exactly one PAYMENT_SETTLED ar_ledger entry":
--
--   1. A partial unique index makes (payment_id, payment_source, 'PAYMENT_SETTLED')
--      idempotent — at most one such ledger row can ever exist.
--   2. append_ar_ledger_entry() short-circuits to a no-op (returns the existing
--      ledger_id) when that entry already exists, so existing application call
--      sites remain safe and unchanged.
--   3. update_invoice_balance_after_payment() — the trigger that already fires
--      on every INSERT/UPDATE/DELETE of invoice_payments and already
--      recomputes invoice.amount_paid from scratch every time (idempotent by
--      design) — now also guarantees the matching ar_ledger entry on any
--      transition into payment_status = 'settled', regardless of which
--      application code path caused it, present or future.
--   4. append_ar_ledger_entry() takes a per-customer advisory lock before its
--      existing SELECT ... FOR UPDATE, closing the narrow race where a
--      customer's very first ledger row (nothing yet to lock) could be
--      inserted twice concurrently.
--   5. The identical advisory-lock hardening is mirrored into
--      append_ap_ledger_entry() (ap_ledger, created earlier today in
--      20260812_04) so the brand-new AP ledger does not repeat AR's history.
--
-- This migration only changes behavior for records created from this point
-- forward. It does not touch or correct any pre-existing ar_ledger rows or
-- drift — see scripts/reconcileArBalances.js for a read-only drift report.

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1. Idempotency: at most one PAYMENT_SETTLED entry per (payment_id, payment_source)
-- ────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_ledger_payment_settled
    ON ar_ledger (payment_id, payment_source, entry_type)
    WHERE payment_id IS NOT NULL AND entry_type = 'PAYMENT_SETTLED';

-- ────────────────────────────────────────────────────────────────
-- 2 & 4. append_ar_ledger_entry(): idempotent short-circuit + advisory lock
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION append_ar_ledger_entry(
    p_customer_id     integer,
    p_invoice_id      integer,
    p_payment_id      integer,
    p_cn_id           integer,
    p_entry_type      ar_ledger_entry_type,
    p_amount          numeric(12,2),
    p_payment_channel varchar(50),
    p_reference_no    varchar(100),
    p_notes           text,
    p_created_by      integer,
    p_payment_source  varchar(30) DEFAULT NULL
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
    v_prev_balance  numeric(12,2);
    v_ledger_id     bigint;
BEGIN
    -- Serialize all ledger activity for this customer, including the very
    -- first-ever row (where there is no existing row for FOR UPDATE to lock).
    PERFORM pg_advisory_xact_lock(hashtext('ar_ledger:' || p_customer_id::text));

    -- Idempotency short-circuit: a settled payment can only ever post one
    -- PAYMENT_SETTLED entry. Safe to call this more than once for the same
    -- payment (e.g. once from a DB trigger, once from application code).
    IF p_payment_id IS NOT NULL AND p_entry_type = 'PAYMENT_SETTLED' THEN
        SELECT ledger_id INTO v_ledger_id
          FROM ar_ledger
         WHERE payment_id = p_payment_id
           AND payment_source IS NOT DISTINCT FROM p_payment_source
           AND entry_type = 'PAYMENT_SETTLED';
        IF FOUND THEN
            RETURN v_ledger_id;
        END IF;
    END IF;

    SELECT balance_after INTO v_prev_balance
      FROM ar_ledger
     WHERE customer_id = p_customer_id
     ORDER BY ledger_id DESC
     LIMIT 1
       FOR UPDATE;

    v_prev_balance := COALESCE(v_prev_balance, 0);

    INSERT INTO ar_ledger
        (customer_id, invoice_id, payment_id, cn_id, entry_type,
         amount, balance_after, payment_channel, reference_no, notes, created_by, payment_source)
    VALUES
        (p_customer_id, p_invoice_id, p_payment_id, p_cn_id, p_entry_type,
         p_amount, v_prev_balance + p_amount, p_payment_channel,
         p_reference_no, p_notes, p_created_by, p_payment_source)
    RETURNING ledger_id INTO v_ledger_id;

    RETURN v_ledger_id;
END;
$$;

-- ────────────────────────────────────────────────────────────────
-- 3. update_invoice_balance_after_payment(): automatic ledger safety net
--
--    This function is shared by triggers on TWO tables (invoice_payments and
--    credit_note — see 20250915_add_payment_settlement_columns.sql). The new
--    ledger safety-net logic only applies to invoice_payments and is fully
--    nested inside an `IF TG_TABLE_NAME = 'invoice_payments'` guard so that a
--    credit_note-triggered invocation (whose NEW/OLD row has no
--    payment_status column) never evaluates NEW.payment_status.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_invoice_balance_after_payment() RETURNS trigger AS $$
DECLARE
    total_settled  numeric(12,2);
    total_refunded numeric(12,2);
    invoice_total  numeric(12,2);
    net_amount     numeric(12,2);
    v_invoice_id   integer;
    v_customer_id  integer;
    v_method_code  varchar(50);
BEGIN
    v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

    SELECT total_amount, customer_id INTO invoice_total, v_customer_id
    FROM invoice WHERE invoice_id = v_invoice_id;

    -- Aggregate settled payments only (pending/bounced do not reduce balance)
    SELECT COALESCE(SUM(amount_paid), 0) INTO total_settled
    FROM invoice_payments
    WHERE invoice_id = v_invoice_id AND payment_status = 'settled';

    -- Aggregate all credit notes applied to this invoice
    SELECT COALESCE(SUM(total_amount), 0) INTO total_refunded
    FROM credit_note WHERE invoice_id = v_invoice_id;

    -- Net collectible amount after refunds (floor at 0)
    net_amount := GREATEST(invoice_total - total_refunded, 0);

    UPDATE invoice
    SET
        amount_paid = total_settled,
        status = CASE
            WHEN total_refunded >= invoice_total                 THEN 'Fully Refunded'
            WHEN net_amount > 0 AND total_settled >= net_amount   THEN 'Paid'
            WHEN total_settled > 0                                 THEN 'Partially Paid'
            ELSE 'Unpaid'
        END
    WHERE invoice_id = v_invoice_id;

    -- Ledger safety net: guarantee a PAYMENT_SETTLED ar_ledger entry exists
    -- whenever an invoice_payments row transitions into 'settled', no matter
    -- which application code path caused it. Idempotent (see function above),
    -- so this is a harmless no-op when the caller already wrote the entry.
    IF TG_TABLE_NAME = 'invoice_payments' THEN
        IF TG_OP IN ('INSERT', 'UPDATE')
           AND NEW.payment_status = 'settled'
           AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM 'settled') THEN

            SELECT code INTO v_method_code FROM payment_methods WHERE method_id = NEW.method_id;

            PERFORM append_ar_ledger_entry(
                v_customer_id, NEW.invoice_id, NEW.payment_id, NULL,
                'PAYMENT_SETTLED'::ar_ledger_entry_type, -NEW.amount_paid,
                v_method_code, NEW.reference,
                'Auto-recorded by invoice balance trigger (ledger safety net)',
                NEW.created_by, 'invoice_payments'
            );
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────────
-- 5. Mirror the advisory-lock hardening into append_ap_ledger_entry()
--    (ap_ledger is structurally identical to ar_ledger and was created
--    earlier today in 20260812_04_create_ap_ledger.sql; no known drift
--    incidents yet, hardening proactively before it accumulates the same
--    debt AR did).
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION append_ap_ledger_entry(
    p_supplier_id     integer,
    p_bill_id         integer,
    p_payment_id      integer,
    p_entry_type      ap_ledger_entry_type,
    p_amount          numeric(12,2),
    p_payment_channel varchar(50),
    p_reference_no    varchar(100),
    p_notes           text,
    p_created_by      integer
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
    v_prev_balance  numeric(12,2);
    v_ledger_id     bigint;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('ap_ledger:' || p_supplier_id::text));

    SELECT balance_after INTO v_prev_balance
      FROM ap_ledger
     WHERE supplier_id = p_supplier_id
     ORDER BY ledger_id DESC
     LIMIT 1
       FOR UPDATE;

    v_prev_balance := COALESCE(v_prev_balance, 0);

    INSERT INTO ap_ledger
        (supplier_id, bill_id, payment_id, entry_type,
         amount, balance_after, payment_channel, reference_no, notes, created_by)
    VALUES
        (p_supplier_id, p_bill_id, p_payment_id, p_entry_type,
         p_amount, v_prev_balance + p_amount, p_payment_channel,
         p_reference_no, p_notes, p_created_by)
    RETURNING ledger_id INTO v_ledger_id;

    RETURN v_ledger_id;
END;
$$;

COMMIT;
