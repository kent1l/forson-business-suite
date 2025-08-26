-- Migration: add metadata JSONB to documents and GIN index for full-text/search
BEGIN;

-- Add metadata JSONB column if not exists
-- If documents table does not exist, create a minimal version
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='documents') THEN
    CREATE TABLE public.documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      document_type character varying(50),
      reference_id character varying(100),
      created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
      file_path text,
      metadata jsonb
    );
  ELSE
    -- Ensure metadata column exists
    ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS metadata JSONB;
  END IF;
END$$;

-- Create GIN index on metadata for fast jsonb search
CREATE INDEX IF NOT EXISTS idx_documents_metadata ON public.documents USING GIN (metadata jsonb_path_ops);

COMMIT;
