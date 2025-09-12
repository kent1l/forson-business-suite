-- Create part aliases table for preserving searchability of old SKUs/part numbers
-- Migration: 20250912_create_part_aliases.sql

CREATE TABLE part_aliases (
    id BIGSERIAL PRIMARY KEY,
    part_id BIGINT NOT NULL REFERENCES part(part_id) ON DELETE CASCADE,
    alias_value VARCHAR(255) NOT NULL,
    alias_type VARCHAR(50) NOT NULL CHECK (alias_type IN ('sku', 'part_number', 'display_name')),
    source_part_id BIGINT REFERENCES part(part_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_part_aliases_part_id ON part_aliases(part_id);
CREATE INDEX idx_part_aliases_value_type ON part_aliases(alias_value, alias_type);
CREATE INDEX idx_part_aliases_source_part ON part_aliases(source_part_id);

-- Unique constraint to prevent duplicate aliases
CREATE UNIQUE INDEX idx_part_aliases_unique ON part_aliases(alias_value, alias_type);

-- Comments for documentation
COMMENT ON TABLE part_aliases IS 'Preserves old SKUs, part numbers, and names from merged parts for searchability';
COMMENT ON COLUMN part_aliases.alias_value IS 'The old value that should redirect to the canonical part';
COMMENT ON COLUMN part_aliases.alias_type IS 'Type of alias: sku, part_number, or display_name';
COMMENT ON COLUMN part_aliases.source_part_id IS 'The original part that this alias came from (before merge)';
