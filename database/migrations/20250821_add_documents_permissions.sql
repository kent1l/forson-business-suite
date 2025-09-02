BEGIN;

INSERT INTO public.permission (permission_key, description, category) VALUES
  ('documents:view', 'View documents', 'Data Management'),
  ('documents:download', 'Download documents', 'Data Management'),
  ('documents:share', 'Share documents', 'Data Management')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant to Admin (10) and Manager (5)
INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM (VALUES (10),(7)) AS pl(permission_level_id)
JOIN public.permission p ON p.permission_key = 'documents:view'
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_permission rp WHERE rp.permission_level_id = pl.permission_level_id AND rp.permission_id = p.permission_id
);

INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM (VALUES (10),(7)) AS pl(permission_level_id)
JOIN public.permission p ON p.permission_key = 'documents:download'
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_permission rp WHERE rp.permission_level_id = pl.permission_level_id AND rp.permission_id = p.permission_id
);

INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM (VALUES (10),(7)) AS pl(permission_level_id)
JOIN public.permission p ON p.permission_key = 'documents:share'
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_permission rp WHERE rp.permission_level_id = pl.permission_level_id AND rp.permission_id = p.permission_id
);

COMMIT;
