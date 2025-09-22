-- Add permission to view any invoice's payment details
-- Created: 2025-09-22
-- Purpose: To allow roles like Manager or Admin to see payment info on all invoices, not just their own.

BEGIN;

-- 1. Add the new permission key
INSERT INTO public.permission (permission_key, description, category) VALUES
  ('invoice_payment_view_any', 'View Payment Details for Any Invoice', 'Sales & A/R')
ON CONFLICT (permission_key) DO NOTHING;

-- 2. Grant this permission to Admin (10) and Manager (7) roles by default
INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM (VALUES (10), (7)) AS pl(permission_level_id)
JOIN public.permission p ON p.permission_key = 'invoice_payment_view_any'
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_permission rp
  WHERE rp.permission_level_id = pl.permission_level_id AND rp.permission_id = p.permission_id
);

COMMIT;