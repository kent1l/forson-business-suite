BEGIN;

-- 1. Enable the vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add embedding column and historical correction fields to the existing expense corrections table
ALTER TABLE expense_ai_correction 
    ADD COLUMN IF NOT EXISTS raw_input TEXT,
    ADD COLUMN IF NOT EXISTS corrected_category VARCHAR(100),
    ADD COLUMN IF NOT EXISTS corrected_data JSONB,
    ADD COLUMN IF NOT EXISTS embedding vector(768);

-- 3. Create HNSW index for ultra-fast cosine similarity vector lookups
CREATE INDEX IF NOT EXISTS idx_expense_correction_vector 
    ON expense_ai_correction USING hnsw (embedding vector_cosine_ops);

COMMIT;
