-- Migration: 20260803_02_seed_pdc_permissions.sql
-- Description: Seed pdc:view and pdc:manage permission keys for Treasury Desk access control

BEGIN;

INSERT INTO permission (permission_key, description, category)
VALUES 
  ('pdc:view',   'View Post-Dated Cheques & Treasury Desk', 'Finance & Treasury'),
  ('pdc:manage', 'Verify clearance, mark bounced, or re-deposit cheques', 'Finance & Treasury')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant to Admin and Management roles
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl
CROSS JOIN permission p
WHERE pl.level_name IN ('Admin', 'Manager', 'Super Admin')
  AND p.permission_key IN ('pdc:view', 'pdc:manage')
ON CONFLICT DO NOTHING;

COMMIT;
