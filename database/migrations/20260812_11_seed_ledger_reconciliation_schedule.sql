-- Migration: 20260812_11_seed_ledger_reconciliation_schedule.sql
-- Description: Seed the cron schedule setting for the new scheduled AR/AP
--              ledger reconciliation scan (packages/api/services/ledgerReconciliationService.js).
--              Companion to the trigger-level safety net added in
--              20260812_10_ar_ledger_production_hardening.sql — this is the
--              monitoring backstop that surfaces any future drift automatically
--              instead of relying on someone remembering to run
--              `npm run reconcile:ar` manually.

BEGIN;

INSERT INTO settings (setting_key, setting_value, description)
VALUES
  ('LEDGER_RECONCILIATION_SCHEDULE', '0 * * * *', 'Cron schedule for the hourly AR/AP ledger balance reconciliation scan')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
