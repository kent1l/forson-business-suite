-- Phase 2 A/R: Seed ar:manage permission
-- Grants the ar:manage permission (manual AR ledger adjustments) to the Admin level.

BEGIN;

INSERT INTO permission (permission_key, description, category)
VALUES ('ar:manage', 'Create manual AR ledger adjustments (debit/credit)', 'Sales & A/R')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl
CROSS JOIN permission p
WHERE pl.level_name = 'Admin'
  AND p.permission_key = 'ar:manage'
ON CONFLICT DO NOTHING;

COMMIT;
