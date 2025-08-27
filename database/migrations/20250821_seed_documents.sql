-- Seed sample documents for local/dev testing
BEGIN;

INSERT INTO documents (id, document_type, reference_id, created_at, updated_at, file_path, metadata)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Invoice', 'INV-TEST-0001', now() - interval '10 days', now() - interval '9 days', '/tmp/sample-invoice-1.pdf', jsonb_build_object('preview_html', '<div><h1>Invoice INV-TEST-0001</h1><p>Sample invoice preview</p></div>', 'amount', 123.45)),
  ('00000000-0000-0000-0000-000000000002', 'GRN', 'GRN-TEST-0001', now() - interval '5 days', now() - interval '4 days', '/tmp/sample-grn-1.pdf', jsonb_build_object('preview_html', '<div><h1>GRN GRN-TEST-0001</h1><p>Goods received</p></div>', 'items', 3)),
  ('00000000-0000-0000-0000-000000000003', 'PurchaseOrders', 'PO-TEST-0001', now() - interval '2 days', now() - interval '1 days', '/tmp/sample-po-1.pdf', jsonb_build_object('preview_html', '<div><h1>PO PO-TEST-0001</h1><p>Purchase order preview</p></div>', 'amount', 789.00));

COMMIT;
