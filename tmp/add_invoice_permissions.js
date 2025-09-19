const db = require('./db');

const sql = `
BEGIN;

INSERT INTO public.permission (permission_key, description, category) VALUES
  ('invoice:delete', 'Delete Invoices', 'Sales & A/R'),
  ('invoice:edit_receipt_no', 'Edit Invoice Receipt Numbers', 'Sales & A/R')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM (VALUES (10)) AS pl(permission_level_id)
JOIN public.permission p ON p.permission_key = 'invoice:delete'
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_permission rp 
  WHERE rp.permission_level_id = pl.permission_level_id AND rp.permission_id = p.permission_id
);

INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM (VALUES (10), (7)) AS pl(permission_level_id)
JOIN public.permission p ON p.permission_key = 'invoice:edit_receipt_no'
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_permission rp 
  WHERE rp.permission_level_id = pl.permission_level_id AND rp.permission_id = p.permission_id
);

COMMIT;
`;

db.query(sql)
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch(e => {
    console.error('Migration failed:', e);
    process.exit(1);
  });