-- Migration: 20260816_04_seed_transaction_date_permissions.sql
-- Description: Permissions for the transaction-date-override feature.
--              transaction:change_date            - move a transaction's date
--                                                    within the same calendar month.
--              transaction:change_date_unrestricted - also allows crossing a
--                                                    month/year boundary and
--                                                    moving cost-bearing
--                                                    (WAC-affecting) inventory
--                                                    transactions.
--              Follows the pattern in 20260802_05_seed_ar_manage_permission.sql:
--              insert permissions, then grant both to Admin by level_name.

BEGIN;

INSERT INTO permission (permission_key, description, category) VALUES
    ('transaction:change_date', 'Correct a transaction''s date (invoice, payment, GRN, bill, inventory adjustment) within the same calendar month, with mandatory reason and full audit logging', 'Administration'),
    ('transaction:change_date_unrestricted', 'Correct a transaction''s date across a month/year boundary, or move a cost-bearing inventory transaction that forces a WAC recompute', 'Administration')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl
CROSS JOIN permission p
WHERE pl.level_name = 'Admin'
  AND p.permission_key IN ('transaction:change_date', 'transaction:change_date_unrestricted')
ON CONFLICT DO NOTHING;

COMMIT;
