-- Phase 2 A/R: Immutable Event-Driven Ledger
-- Creates the ar_ledger table, immutability guard, append helper, and balance view.

BEGIN;

-- ────────────────────────────────────────────
-- 1. Entry type enum
-- ────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE ar_ledger_entry_type AS ENUM (
    'INVOICE_POSTED',
    'PAYMENT_SETTLED',
    'CREDIT_MEMO_APPLIED',
    'DEBIT_ADJUSTMENT',
    'CREDIT_ADJUSTMENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ────────────────────────────────────────────
-- 2. Core ledger table (append-only — never UPDATE/DELETE)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ar_ledger (
    ledger_id       bigserial               PRIMARY KEY,
    customer_id     integer                 NOT NULL REFERENCES customer(customer_id),
    invoice_id      integer                 REFERENCES invoice(invoice_id),
    payment_id      integer                 REFERENCES invoice_payments(payment_id),
    cn_id           integer                 REFERENCES credit_note(cn_id),
    entry_type      ar_ledger_entry_type    NOT NULL,
    -- Positive = balance increases (debit), Negative = balance decreases (credit)
    amount          numeric(12,2)           NOT NULL,
    balance_after   numeric(12,2)           NOT NULL,
    payment_channel varchar(50),            -- payment_methods.code e.g. 'cash','bank_transfer','cheque'
    reference_no    varchar(100),
    notes           text,
    created_at      timestamptz             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by      integer                 REFERENCES employee(employee_id)
);

CREATE INDEX IF NOT EXISTS idx_ar_ledger_customer ON ar_ledger(customer_id, ledger_id DESC);
CREATE INDEX IF NOT EXISTS idx_ar_ledger_invoice  ON ar_ledger(invoice_id)  WHERE invoice_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ar_ledger_payment  ON ar_ledger(payment_id)  WHERE payment_id  IS NOT NULL;

-- ────────────────────────────────────────────
-- 3. Immutability guard — prevents UPDATE or DELETE on any row
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ar_ledger_immutability_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'ar_ledger rows are immutable — UPDATE/DELETE not permitted';
END;
$$;

DROP TRIGGER IF EXISTS trg_ar_ledger_immutable ON ar_ledger;
CREATE TRIGGER trg_ar_ledger_immutable
    BEFORE UPDATE OR DELETE ON ar_ledger
    FOR EACH ROW EXECUTE FUNCTION ar_ledger_immutability_guard();

-- ────────────────────────────────────────────
-- 4. append_ar_ledger_entry(...)
--    Computes running balance_after automatically.
--    MUST be called inside an open transaction (BEGIN already issued by caller).
--    Uses SELECT ... FOR UPDATE on the last row to prevent concurrent balance races.
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
    p_created_by      integer
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
    v_prev_balance  numeric(12,2);
    v_ledger_id     bigint;
BEGIN
    -- Lock the most recent row for this customer to avoid concurrent balance races
    SELECT balance_after INTO v_prev_balance
      FROM ar_ledger
     WHERE customer_id = p_customer_id
     ORDER BY ledger_id DESC
     LIMIT 1
       FOR UPDATE;

    v_prev_balance := COALESCE(v_prev_balance, 0);

    INSERT INTO ar_ledger
        (customer_id, invoice_id, payment_id, cn_id, entry_type,
         amount, balance_after, payment_channel, reference_no, notes, created_by)
    VALUES
        (p_customer_id, p_invoice_id, p_payment_id, p_cn_id, p_entry_type,
         p_amount, v_prev_balance + p_amount, p_payment_channel,
         p_reference_no, p_notes, p_created_by)
    RETURNING ledger_id INTO v_ledger_id;

    RETURN v_ledger_id;
END;
$$;

-- ────────────────────────────────────────────
-- 5. vw_customer_ar_balance — fast per-customer balance lookup
--    Used by arRoutes.js as the authoritative balance source.
-- ────────────────────────────────────────────
CREATE OR REPLACE VIEW vw_customer_ar_balance AS
SELECT
    customer_id,
    COALESCE(SUM(amount), 0)  AS ledger_balance,
    COUNT(*)                   AS entry_count,
    MAX(created_at)            AS last_activity_at
FROM ar_ledger
GROUP BY customer_id;

COMMIT;
