-- Add documents permissions and grant to Manager & Admin (idempotent)
BEGIN;

INSERT INTO permission (permission_key, description) VALUES
  ('documents:view', 'View documents'),
  ('documents:download', 'Download documents'),
  ('documents:share', 'Share documents')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant to Admin (10) and Manager (5)
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM (VALUES (10),(5)) AS pl(permission_level_id)
JOIN permission p ON p.permission_key = 'documents:view'
WHERE NOT EXISTS (
  SELECT 1 FROM role_permission rp WHERE rp.permission_level_id = pl.permission_level_id AND rp.permission_id = p.permission_id
);

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM (VALUES (10),(5)) AS pl(permission_level_id)
JOIN permission p ON p.permission_key = 'documents:download'
WHERE NOT EXISTS (
  SELECT 1 FROM role_permission rp WHERE rp.permission_level_id = pl.permission_level_id AND rp.permission_id = p.permission_id
);

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM (VALUES (10),(5)) AS pl(permission_level_id)
JOIN permission p ON p.permission_key = 'documents:share'
WHERE NOT EXISTS (
  SELECT 1 FROM role_permission rp WHERE rp.permission_level_id = pl.permission_level_id AND rp.permission_id = p.permission_id
);

COMMIT;
