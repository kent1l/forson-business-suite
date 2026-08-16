-- Migration: 20260816_06_fix_ar_ledger_guard_payment_source.sql
-- Description: The narrowed immutability guard installed by
--              20260816_01_add_entry_date_to_ledgers.sql enumerates every
--              ar_ledger column that must stay immutable, but omitted
--              payment_source (added later by
--              20260808_01_add_payment_source_to_ar_ledger.sql). That left
--              payment_source updatable without raising, even though it is
--              not cosmetic: it is the discriminator in the PAYMENT_SETTLED
--              idempotency unique index (uq_ar_ledger_payment_settled,
--              20260812_10_ar_ledger_production_hardening.sql) and in
--              append_ar_ledger_entry's own idempotency short-circuit. A row
--              whose payment_source was silently flipped could let a
--              duplicate PAYMENT_SETTLED entry be inserted for the same
--              payment, corrupting a customer's AR balance.
--
--              ap_ledger has no equivalent column and is unaffected.

BEGIN;

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
           NEW.created_by      IS DISTINCT FROM OLD.created_by      OR
           NEW.payment_source  IS DISTINCT FROM OLD.payment_source
        THEN
            RAISE EXCEPTION 'ar_ledger rows are immutable — only entry_date may be corrected';
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'ar_ledger rows are immutable — UPDATE/DELETE not permitted';
END;
$$;

-- NOTE for whoever adds the next column to ar_ledger: this guard is an
-- explicit allow-list (only entry_date may change) enforced by comparing
-- every OTHER column. Add new columns to the IS DISTINCT FROM chain above,
-- not to some other file — this is the single place immutability is decided.

COMMIT;
