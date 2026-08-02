-- Migration: 20260802_08_add_pdc_bounced_ledger_entry_types.sql
-- Description: Add PDC_BOUNCED_REVERSAL and BOUNCE_FEE_PENALTY to ar_ledger_entry_type enum

ALTER TYPE ar_ledger_entry_type ADD VALUE IF NOT EXISTS 'PDC_BOUNCED_REVERSAL';
ALTER TYPE ar_ledger_entry_type ADD VALUE IF NOT EXISTS 'BOUNCE_FEE_PENALTY';
