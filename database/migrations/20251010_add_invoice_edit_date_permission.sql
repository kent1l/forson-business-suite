-- Add permission for editing invoice date and time
-- Created: 2025-10-10
-- Purpose: Allow authorized users to modify invoice dates and related transaction timestamps

BEGIN;

-- Add new permission for editing invoice date
INSERT INTO public.permission (permission_key, description, category) VALUES
  ('invoice:edit_date', 'Edit Invoice Date and Time', 'Sales & A/R')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant this permission to Admin (10) and Manager (7) by default
INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM (VALUES (10), (7)) AS pl(permission_level_id)
JOIN public.permission p ON p.permission_key = 'invoice:edit_date'
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_permission rp 
  WHERE rp.permission_level_id = pl.permission_level_id AND rp.permission_id = p.permission_id
);

COMMIT;