-- Migration: 20260906_04_ar_adjustment_entry_types.sql
-- Description: Ledger entry types for post-invoice A/R concessions.
--
-- Alone in its own migration on purpose. Postgres will not let a newly added
-- enum label be used in the same transaction that adds it, and the tables and
-- functions in 20260906_05 need to reference these. 20260830_03_withholding_tax.sql
-- hit the same wall and had to leave a note saying the label was "not used until
-- this transaction commits"; splitting the file removes the trap entirely.
--
-- All three settle or restate a receivable without cash changing hands, which is
-- exactly what CREDIT_MEMO_APPLIED and WITHHOLDING_TAX_CREDIT already do. They
-- get their own labels rather than reusing CREDIT_ADJUSTMENT because every
-- cash-basis report and the Statement of Account distinguish "collected" from
-- "conceded" by entry type, and a customer reading their statement is entitled
-- to see which of the two happened.

ALTER TYPE public.ar_ledger_entry_type ADD VALUE IF NOT EXISTS 'SETTLEMENT_DISCOUNT';
ALTER TYPE public.ar_ledger_entry_type ADD VALUE IF NOT EXISTS 'BALANCE_WRITE_DOWN';
ALTER TYPE public.ar_ledger_entry_type ADD VALUE IF NOT EXISTS 'ADJUSTMENT_REVERSAL';
