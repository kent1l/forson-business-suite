-- Grant invoicing:create to Parts Man
-- Parts Man could use POS but lacked invoicing:create, blocking completion of
-- invoices from the POS flow. Cashier/Secretary/Manager already have this
-- permission; Parts Man was missing it.

BEGIN;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl
CROSS JOIN permission p
WHERE pl.level_name = 'Parts Man'
  AND p.permission_key = 'invoicing:create'
ON CONFLICT DO NOTHING;

COMMIT;
