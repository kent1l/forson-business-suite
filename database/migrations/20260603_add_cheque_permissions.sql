BEGIN;

-- Insert the new granular permissions for the Cheque Module
INSERT INTO public.permission (permission_key, description, category) VALUES
    ('cheques:view', 'View cheque printing interface and history', 'Cheques'),
    ('cheques:create', 'Create and print new cheques', 'Cheques'),
    ('cheques:manage_settings', 'Manage cheque templates and printer profiles', 'Cheques')
ON CONFLICT (permission_key) DO NOTHING;

-- Automatically assign these to the Admin role (permission_level_id = 10)
INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT 10, p.permission_id
FROM public.permission p
WHERE p.permission_key IN ('cheques:view', 'cheques:create', 'cheques:manage_settings')
ON CONFLICT DO NOTHING;

COMMIT;
