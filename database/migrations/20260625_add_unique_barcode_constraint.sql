-- Migration: 20260625_add_unique_barcode_constraint.sql
-- Safely normalize empty-string barcodes to NULL, then enforce uniqueness.

-- Step 1: Convert any empty string barcodes to NULL so they don't collide
--         with each other under a UNIQUE constraint (NULLs are never equal).
UPDATE parts SET barcode = NULL WHERE barcode = '';

-- Step 2: Add the unique constraint. IF it already exists (idempotent re-run),
--         the IF NOT EXISTS guard on the DO block prevents an error.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'parts_barcode_key'
          AND conrelid = 'parts'::regclass
    ) THEN
        ALTER TABLE parts ADD CONSTRAINT parts_barcode_key UNIQUE (barcode);
    END IF;
END
$$;
