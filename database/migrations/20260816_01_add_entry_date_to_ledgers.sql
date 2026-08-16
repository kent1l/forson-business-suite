-- Migration: 20260816_01_add_entry_date_to_ledgers.sql
-- Description: Adds a correctable business date (`entry_date`) to ar_ledger and
--              ap_ledger, separate from the immutable audit timestamp
--              (`created_at`). Narrows the immutability guard on both tables so
--              that ONLY entry_date may ever be changed after insert — every
--              other column (amount, balance_after, entry_type, customer_id /
--              supplier_id, created_at, ...) remains permanently immutable.
--              This is the ledger half of the transaction-date-override feature;
--              see transactionDateService.js for the only code path that is
--              expected to update entry_date.

BEGIN;

-- ────────────────────────────────────────────
-- 1. Add the columns (ALTER ... ADD COLUMN does not fire the row-level
--    UPDATE/DELETE guard trigger, so this is safe to do before step 3 below).
-- ────────────────────────────────────────────
ALTER TABLE ar_ledger ADD COLUMN IF NOT EXISTS entry_date timestamptz;
ALTER TABLE ap_ledger ADD COLUMN IF NOT EXISTS entry_date timestamptz;

-- ────────────────────────────────────────────
-- 2. Narrow the immutability guards BEFORE backfilling, so the backfill
--    UPDATE below (which only touches entry_date) is permitted. Allow UPDATE
--    only when the sole change
--    is to entry_date. Any attempt to touch another column, or any DELETE,
--    still raises exactly as before.
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ar_ledger_immutability_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.ledger_id       IS DISTINCT FROM OLD.ledger_id       OR
           NEW.customer_id     IS DISTINCT FROM OLD.customer_id     OR
           NEW.invoice_id      IS DISTINCT FROM OLD.invoice_id      OR
           NEW.payment_id      IS DISTINCT FROM OLD.payment_id      OR
           NEW.cn_id           IS DISTINCT FROM OLD.cn_id           OR
           NEW.entry_type      IS DISTINCT FROM OLD.entry_type      OR
           NEW.amount          IS DISTINCT FROM OLD.amount          OR
           NEW.balance_after   IS DISTINCT FROM OLD.balance_after   OR
           NEW.payment_channel IS DISTINCT FROM OLD.payment_channel OR
           NEW.reference_no    IS DISTINCT FROM OLD.reference_no    OR
           NEW.notes           IS DISTINCT FROM OLD.notes           OR
           NEW.created_at      IS DISTINCT FROM OLD.created_at      OR
           NEW.created_by      IS DISTINCT FROM OLD.created_by
        THEN
            RAISE EXCEPTION 'ar_ledger rows are immutable — only entry_date may be corrected';
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'ar_ledger rows are immutable — UPDATE/DELETE not permitted';
END;
$$;

CREATE OR REPLACE FUNCTION ap_ledger_immutability_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.ledger_id       IS DISTINCT FROM OLD.ledger_id       OR
           NEW.supplier_id     IS DISTINCT FROM OLD.supplier_id     OR
           NEW.bill_id         IS DISTINCT FROM OLD.bill_id         OR
           NEW.payment_id      IS DISTINCT FROM OLD.payment_id      OR
           NEW.entry_type      IS DISTINCT FROM OLD.entry_type      OR
           NEW.amount          IS DISTINCT FROM OLD.amount          OR
           NEW.balance_after   IS DISTINCT FROM OLD.balance_after   OR
           NEW.payment_channel IS DISTINCT FROM OLD.payment_channel OR
           NEW.reference_no    IS DISTINCT FROM OLD.reference_no    OR
           NEW.notes           IS DISTINCT FROM OLD.notes           OR
           NEW.created_at      IS DISTINCT FROM OLD.created_at      OR
           NEW.created_by      IS DISTINCT FROM OLD.created_by
        THEN
            RAISE EXCEPTION 'ap_ledger rows are immutable — only entry_date may be corrected';
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'ap_ledger rows are immutable — UPDATE/DELETE not permitted';
END;
$$;

-- Triggers already exist (BEFORE UPDATE OR DELETE ... FOR EACH ROW); the
-- CREATE OR REPLACE FUNCTION above is sufficient, no need to recreate them.

-- ────────────────────────────────────────────
-- 3. Backfill entry_date from created_at (permitted now that the guard above
--    allows entry_date-only updates), then lock the column down.
-- ────────────────────────────────────────────
UPDATE ar_ledger SET entry_date = created_at WHERE entry_date IS NULL;
ALTER TABLE ar_ledger ALTER COLUMN entry_date SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE ar_ledger ALTER COLUMN entry_date SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ar_ledger_customer_entry_date ON ar_ledger(customer_id, entry_date);

UPDATE ap_ledger SET entry_date = created_at WHERE entry_date IS NULL;
ALTER TABLE ap_ledger ALTER COLUMN entry_date SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE ap_ledger ALTER COLUMN entry_date SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ap_ledger_supplier_entry_date ON ap_ledger(supplier_id, entry_date);

-- ────────────────────────────────────────────
-- 4. Extend append_ar_ledger_entry / append_ap_ledger_entry with an optional
--    trailing p_entry_date parameter (defaults to CURRENT_TIMESTAMP), so all
--    ~30 existing call sites keep working unchanged while new callers (e.g.
--    a transaction created with a backdated invoice/payment date from day
--    one) can supply the correct business date at insert time.
-- ────────────────────────────────────────────
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
    p_payment_source  varchar(30) DEFAULT NULL,
    p_entry_date      timestamptz DEFAULT CURRENT_TIMESTAMP
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
    v_prev_balance  numeric(12,2);
    v_ledger_id     bigint;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('ar_ledger:' || p_customer_id::text));

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
         amount, balance_after, payment_channel, reference_no, notes, created_by,
         payment_source, entry_date)
    VALUES
        (p_customer_id, p_invoice_id, p_payment_id, p_cn_id, p_entry_type,
         p_amount, v_prev_balance + p_amount, p_payment_channel,
         p_reference_no, p_notes, p_created_by, p_payment_source,
         COALESCE(p_entry_date, CURRENT_TIMESTAMP))
    RETURNING ledger_id INTO v_ledger_id;

    RETURN v_ledger_id;
END;
$$;

CREATE OR REPLACE FUNCTION append_ap_ledger_entry(
    p_supplier_id     integer,
    p_bill_id         integer,
    p_payment_id      integer,
    p_entry_type      ap_ledger_entry_type,
    p_amount          numeric(12,2),
    p_payment_channel varchar(50),
    p_reference_no    varchar(100),
    p_notes           text,
    p_created_by      integer,
    p_entry_date      timestamptz DEFAULT CURRENT_TIMESTAMP
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
         amount, balance_after, payment_channel, reference_no, notes, created_by,
         entry_date)
    VALUES
        (p_supplier_id, p_bill_id, p_payment_id, p_entry_type,
         p_amount, v_prev_balance + p_amount, p_payment_channel,
         p_reference_no, p_notes, p_created_by,
         COALESCE(p_entry_date, CURRENT_TIMESTAMP))
    RETURNING ledger_id INTO v_ledger_id;

    RETURN v_ledger_id;
END;
$$;

-- ────────────────────────────────────────────
-- 5. Balance views: keep as-is (they aggregate SUM(amount), which is
--    date-agnostic by design — see vw_customer_ar_balance / vw_supplier_ap_balance
--    in 20260802_03_create_ar_ledger.sql / 20260812_04_create_ap_ledger.sql).
--    Period/aging queries in arRoutes.js / apRoutes.js are updated separately
--    to filter on entry_date instead of created_at.
-- ────────────────────────────────────────────

COMMIT;
