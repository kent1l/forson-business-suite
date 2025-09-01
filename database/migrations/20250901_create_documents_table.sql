CREATE TABLE IF NOT EXISTS public.documents (
    id uuid PRIMARY KEY,
    document_type character varying(50) NOT NULL,
    reference_id character varying(100) NOT NULL,
    file_path text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
