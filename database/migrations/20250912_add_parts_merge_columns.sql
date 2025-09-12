-- Add parts merge support columns
-- Migration: 20250912_add_parts_merge_columns.sql

-- Add merged_into_part_id column to track which part this was merged into
ALTER TABLE part 
ADD COLUMN merged_into_part_id BIGINT REFERENCES part(part_id);

-- Add index for performance on merged parts queries
CREATE INDEX idx_part_merged_into ON part(merged_into_part_id);

-- Update unique constraint on internal_sku to allow merged parts to have duplicate SKUs
-- by making it a partial unique index that only applies to non-merged parts
ALTER TABLE part DROP CONSTRAINT IF EXISTS part_internal_sku_key;
CREATE UNIQUE INDEX part_internal_sku_unique ON part(internal_sku) 
WHERE merged_into_part_id IS NULL;

-- Add comment for clarity
COMMENT ON COLUMN part.merged_into_part_id IS 'If not null, this part has been merged into the referenced part and should be considered inactive';
