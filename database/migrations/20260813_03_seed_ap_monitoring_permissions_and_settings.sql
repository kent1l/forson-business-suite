-- Migration: 20260813_03_seed_ap_monitoring_permissions_and_settings.sql
-- Description: Seed ap:view / ap:manage permissions for the new AP monitoring
--              dashboard (aging, balances, supplier ledger) — kept separate from
--              ap-pdc:* so monitoring access doesn't imply cheque-issuing rights.
--              Also seeds the AP due-date reminder cron schedule.

BEGIN;

INSERT INTO permission (permission_key, description, category)
VALUES
  ('ap:view',   'View Accounts Payable monitoring dashboard (aging, balances, supplier ledger)', 'Finance & Treasury'),
  ('ap:manage', 'Manage Accounts Payable records: bill due dates, supplier payment holds', 'Finance & Treasury')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl
CROSS JOIN permission p
WHERE pl.level_name IN ('Admin', 'Manager', 'Super Admin')
  AND p.permission_key IN ('ap:view', 'ap:manage')
ON CONFLICT DO NOTHING;

INSERT INTO settings (setting_key, setting_value, description)
VALUES
  ('AP_DUE_DATE_REMINDER_SCHEDULE', '0 7 * * *', 'Cron schedule for the daily supplier bill due-date reminder scan')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
