-- Migration: ensure metadata JSONB & index exist on documents (v2)
BEGIN;

-- Ensure column exists
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Ensure index exists
CREATE INDEX IF NOT EXISTS idx_documents_metadata ON public.documents USING GIN (metadata jsonb_path_ops);

COMMIT;
