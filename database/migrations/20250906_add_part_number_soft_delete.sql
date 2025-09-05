-- Migration: Soft delete support for part_number and allow re-use of removed aliases
-- Date: 2025-09-06
-- Adds deleted_at & deleted_by columns and replaces table-level unique constraint
-- with a partial unique index over active (non-deleted) rows so previously removed
-- part numbers can be re-used.

ALTER TABLE public.part_number
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
    ADD COLUMN IF NOT EXISTS deleted_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL;

-- Drop existing unique constraint if it exists (name is typically auto-generated)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conrelid = 'public.part_number'::regclass 
          AND conname = 'part_number_part_id_part_number_key'
    ) THEN
        ALTER TABLE public.part_number DROP CONSTRAINT part_number_part_id_part_number_key;
    END IF;
END$$;

-- Create partial unique index for active (non-deleted) part numbers
CREATE UNIQUE INDEX IF NOT EXISTS ux_part_number_active_unique
    ON public.part_number (part_id, part_number)
    WHERE deleted_at IS NULL;

-- (Optional) Backfill display_order for any rows missing it (assign sequential per part)
WITH ordered AS (
    SELECT part_number_id,
           ROW_NUMBER() OVER (PARTITION BY part_id ORDER BY COALESCE(display_order, 1), part_number_id) AS rn
    FROM public.part_number
    WHERE deleted_at IS NULL
)
UPDATE public.part_number pn
SET display_order = ordered.rn
FROM ordered
WHERE pn.part_number_id = ordered.part_number_id
  AND (pn.display_order IS NULL OR pn.display_order <> ordered.rn);

COMMENT ON COLUMN public.part_number.deleted_at IS 'Timestamp when alias was soft-deleted (NULL = active)';
COMMENT ON COLUMN public.part_number.deleted_by IS 'Employee who removed the alias';
COMMENT ON INDEX ux_part_number_active_unique IS 'Ensures active (non-deleted) aliases remain unique per part';
