-- Migration: 20261022_01_configurable_document_types_and_last_selection.sql
-- Enables full application settings management for document types and pre-selection memory

-- 1. Allow physical_document_last_success to record Notebook or series-less selections
ALTER TABLE public.physical_document_last_success 
    ALTER COLUMN last_series_id DROP NOT NULL;

ALTER TABLE public.physical_document_last_success 
    ADD COLUMN IF NOT EXISTS recording_method VARCHAR(20) DEFAULT 'PAPER';

ALTER TABLE public.physical_document_last_success 
    ADD COLUMN IF NOT EXISTS last_type_code VARCHAR(50);

-- 2. Relax hardcoded controlled_category constraint so custom document types can be configured
ALTER TABLE public.physical_document_type 
    DROP CONSTRAINT IF EXISTS chk_physical_doc_type_cat;

-- 3. Activate base document types so they are immediately available for configuration
UPDATE public.physical_document_type 
SET is_active = true 
WHERE code IN ('SALES_INVOICE_VAT', 'COLLECTION_RECEIPT', 'DELIVERY_RECEIPT', 'NOTEBOOK');

-- 4. Seed default LAST_SUCCESSFUL selection policy across standard cashier contexts
INSERT INTO public.physical_document_selection_policy (context, workstation_id, mode, allow_notebook)
SELECT c.context, 'default', 'LAST_SUCCESSFUL', true
FROM (VALUES ('POS'), ('INVOICING'), ('CASHIER_APPROVAL'), ('COLLECTION')) AS c(context)
WHERE NOT EXISTS (
    SELECT 1 FROM public.physical_document_selection_policy p
    WHERE p.context = c.context AND (p.workstation_id = 'default' OR p.workstation_id IS NULL)
);
