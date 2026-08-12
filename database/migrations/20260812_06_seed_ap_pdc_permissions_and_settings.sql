-- Migration: 20260812_06_seed_ap_pdc_permissions_and_settings.sql
-- Description: Seed ap-pdc permissions (outbound Treasury Desk access) and
--              configurable PDC thresholds so the stale-cheque cutoff and the
--              bounce-count that triggers a "replacement needed" flag are
--              admin-tunable instead of hardcoded.

BEGIN;

INSERT INTO permission (permission_key, description, category)
VALUES
  ('ap-pdc:view',   'View Outbound Supplier/General Cheques & Treasury Desk', 'Finance & Treasury'),
  ('ap-pdc:manage', 'Issue, void, replace, verify, bounce, or re-deposit outbound cheques', 'Finance & Treasury')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl
CROSS JOIN permission p
WHERE pl.level_name IN ('Admin', 'Manager', 'Super Admin')
  AND p.permission_key IN ('ap-pdc:view', 'ap-pdc:manage')
ON CONFLICT DO NOTHING;

INSERT INTO settings (setting_key, setting_value, description)
VALUES
  ('PDC_STALE_DAYS', '180', 'Days past cheque date after which an uncleared PDC is flagged stale'),
  ('PDC_MAX_BOUNCE_ATTEMPTS', '2', 'Bounce attempts after which a cheque is flagged as needing replacement'),
  ('PDC_REMINDER_SCHEDULE', '0 7 * * *', 'Cron schedule for the daily PDC due-date reminder scan')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
