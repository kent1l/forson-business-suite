-- Add permission for editing goods receipts
INSERT INTO public.permission (permission_key, description, category) VALUES
('goods_receipt:edit', 'Edit Goods Receipts', 'Inventory & Purchasing')
ON CONFLICT (permission_key) DO NOTHING;

-- Assign to appropriate roles (Admin, Manager, Purchaser, Secretary, Cashier)
INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM public.permission_level pl
CROSS JOIN public.permission p
WHERE p.permission_key = 'goods_receipt:edit'
  AND pl.level_name IN ('Admin', 'Manager', 'Purchaser', 'Secretary', 'Cashier')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permission rp
    WHERE rp.permission_level_id = pl.permission_level_id
      AND rp.permission_id = p.permission_id
  )
ON CONFLICT DO NOTHING;
