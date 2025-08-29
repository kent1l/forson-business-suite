-- Idempotent seed: populate role_permission by assigning all existing permissions to existing roles
-- Safe to run multiple times. Uses INSERT ... SELECT ... ON CONFLICT DO NOTHING

BEGIN;

INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM public.permission_level pl
CROSS JOIN public.permission p
WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permission rp
    WHERE rp.permission_level_id = pl.permission_level_id
      AND rp.permission_id = p.permission_id
)
ON CONFLICT DO NOTHING;

COMMIT;

-- Optional: To limit assignments in production, replace CROSS JOIN with an explicit mapping.
