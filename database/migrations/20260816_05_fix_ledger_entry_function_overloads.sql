-- Migration: 20260816_05_fix_ledger_entry_function_overloads.sql
-- Description: 20260816_01_add_entry_date_to_ledgers.sql added a trailing
--              p_entry_date parameter to append_ar_ledger_entry /
--              append_ap_ledger_entry via CREATE OR REPLACE FUNCTION.
--              Postgres only replaces a function in place when the new
--              definition's signature exactly matches an existing one — since
--              the prior 11-arg (AR) / 9-arg (AP) signatures were registered
--              as their own distinct catalog entries (by
--              20260812_10_ar_ledger_production_hardening.sql and
--              20260812_12_ap_ledger_production_hardening.sql), adding a
--              parameter created a second overload instead of replacing them.
--
--              That left BOTH the old and new signatures installed. Any
--              caller invoking the function at the old arity — including the
--              safety-net triggers update_invoice_balance_after_payment()
--              (invoice_payments settlement) and the AP mirror
--              (ap_payment/ap_payment_allocation settlement), both of which
--              PERFORM the function with the old positional argument count —
--              now hits "function ... is not unique", because Postgres can no
--              longer tell whether to use the old function or the new one's
--              default-filled call. That aborts payment settlement entirely.
--
--              Fix: drop the old-arity overloads so only the entry_date-aware
--              versions remain. This does not change behavior for any
--              existing caller — every parameter up to and including
--              p_payment_source keeps the same meaning; only the new trailing
--              p_entry_date defaults to CURRENT_TIMESTAMP when omitted, which
--              is exactly what the dropped overloads always did implicitly
--              via the entry_date column's own DEFAULT.

BEGIN;

DROP FUNCTION IF EXISTS append_ar_ledger_entry(
    integer, integer, integer, integer, ar_ledger_entry_type, numeric,
    varchar, varchar, text, integer, varchar
);

DROP FUNCTION IF EXISTS append_ap_ledger_entry(
    integer, integer, integer, ap_ledger_entry_type, numeric,
    varchar, varchar, text, integer
);

COMMIT;
