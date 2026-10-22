-- Keep previous paper assignments while allowing a new current assignment.
ALTER TABLE public.invoice ADD COLUMN IF NOT EXISTS physical_receipt_version INT NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS public.uq_source_link_invoice;
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_link_invoice
    ON public.physical_document_source_link (invoice_id)
    WHERE invoice_id IS NOT NULL AND role = 'PRIMARY';

INSERT INTO public.permission (permission_key, description, category)
VALUES ('invoice:release_receipt_no', 'Release mistakenly assigned unused physical receipt numbers', 'Sales & A/R')
ON CONFLICT (permission_key) DO NOTHING;
INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM public.permission_level pl CROSS JOIN public.permission p
WHERE pl.permission_level_id IN (7, 10) AND p.permission_key = 'invoice:release_receipt_no'
ON CONFLICT DO NOTHING;

-- Repair tracked invoices cancelled by the old void endpoint, which cleared
-- the invoice reference but left the paper registry ISSUED. No number is freed.
INSERT INTO public.physical_document_event
    (series_id, registry_id, source_type, source_id, event_type, submitted_reference, reason, before_state, after_state)
SELECT r.series_id, r.registry_id, 'INVOICE', i.invoice_id, 'VOIDED', r.canonical_full_reference,
       'Repair receipt state for previously cancelled invoice',
       jsonb_build_object('state', r.state), jsonb_build_object('state', 'VOIDED')
FROM public.invoice i JOIN public.physical_document_registry r ON r.registry_id = i.physical_document_registry_id
WHERE i.status = 'Cancelled' AND r.state = 'ISSUED';

UPDATE public.physical_document_registry r
SET state = 'VOIDED', version = r.version + 1, updated_at = CURRENT_TIMESTAMP
FROM public.invoice i
WHERE i.physical_document_registry_id = r.registry_id AND i.status = 'Cancelled' AND r.state = 'ISSUED';

UPDATE public.invoice i
SET physical_receipt_no = r.canonical_full_reference, physical_receipt_version = i.physical_receipt_version + 1
FROM public.physical_document_registry r
WHERE i.physical_document_registry_id = r.registry_id AND i.status = 'Cancelled'
  AND i.physical_receipt_no IS NULL AND r.state IN ('VOIDED', 'SPOILED');

-- Only the current ISSUED assignment can exclude itself. Historical voided or
-- spoiled paper must still block reuse, including by its previous invoice.
CREATE OR REPLACE FUNCTION public.is_physical_receipt_no_taken(
    p_receipt_no TEXT, p_ignore_invoice_id INT DEFAULT NULL, p_ignore_payment_id INT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_clean TEXT := UPPER(TRIM(p_receipt_no));
BEGIN
    IF v_clean IS NULL OR v_clean = '' THEN RETURN FALSE; END IF;
    RETURN EXISTS (
        SELECT 1 FROM public.invoice
        WHERE UPPER(TRIM(physical_receipt_no)) = v_clean
          AND (p_ignore_invoice_id IS NULL OR invoice_id != p_ignore_invoice_id)
        UNION ALL
        SELECT 1 FROM public.customer_payment
        WHERE UPPER(TRIM(physical_receipt_no)) = v_clean
          AND (p_ignore_payment_id IS NULL OR payment_id != p_ignore_payment_id)
        UNION ALL
        SELECT 1 FROM public.staged_sale
        WHERE UPPER(TRIM(physical_receipt_no)) = v_clean AND status NOT IN ('REJECTED', 'CANCELLED')
        UNION ALL
        SELECT 1 FROM public.physical_document_registry r
        WHERE r.canonical_full_reference = v_clean AND r.state IN ('ISSUED', 'VOIDED', 'SPOILED')
          AND NOT (r.state = 'ISSUED' AND EXISTS (
              SELECT 1 FROM public.physical_document_source_link sl
              WHERE sl.registry_id = r.registry_id AND sl.role = 'PRIMARY'
                AND ((p_ignore_invoice_id IS NOT NULL AND sl.invoice_id = p_ignore_invoice_id)
                  OR (p_ignore_payment_id IS NOT NULL AND sl.payment_id = p_ignore_payment_id))
          ))
    );
END;
$$ LANGUAGE plpgsql STABLE;
