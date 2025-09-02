-- Migration: create documents table if missing (idempotent when initial schema already has it)
BEGIN;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM information_schema.tables 
		WHERE table_schema='public' AND table_name='documents'
	) THEN
		CREATE EXTENSION IF NOT EXISTS pgcrypto;
		CREATE TABLE public.documents (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			document_type character varying(50),
			reference_id character varying(100),
			created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
			updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
			file_path text,
			metadata jsonb
		);
	END IF;
END$$;

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON public.documents (created_at);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type ON public.documents (document_type);
CREATE INDEX IF NOT EXISTS idx_documents_reference_id ON public.documents (reference_id);
CREATE INDEX IF NOT EXISTS idx_documents_metadata ON public.documents USING GIN (metadata jsonb_path_ops);

COMMIT;
