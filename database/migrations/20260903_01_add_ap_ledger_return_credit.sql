-- Migration: 20260903_01_add_ap_ledger_return_credit.sql
-- Description: Adds RETURN_CREDIT to the ap_ledger entry type enum.
--
--   Goods rejected at the dock or returned to the supplier after receiving reduce
--   what is owed on that supplier's bill. That reduction was previously only
--   expressible as a generic CREDIT_ADJUSTMENT, which is also what a void, a
--   negotiated write-down and a manual correction use — so AP reporting could not
--   tell a physical goods return apart from a paperwork fix. RETURN_CREDIT names it.
--
--   This lives in its own migration file, ahead of the migration that uses it,
--   because a new enum value cannot be referenced by any statement in the same
--   transaction that added it.

ALTER TYPE ap_ledger_entry_type ADD VALUE IF NOT EXISTS 'RETURN_CREDIT';
