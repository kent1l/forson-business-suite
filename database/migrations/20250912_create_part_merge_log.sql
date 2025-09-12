-- Create part merge log table for audit trail
-- Migration: 20250912_create_part_merge_log.sql

CREATE TABLE part_merge_log (
    id BIGSERIAL PRIMARY KEY,
    merged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_employee_id BIGINT NOT NULL REFERENCES employee(employee_id),
    keep_part_id BIGINT NOT NULL REFERENCES part(part_id),
    merged_part_id BIGINT NOT NULL REFERENCES part(part_id),
    field_overrides JSONB,
    merge_rules JSONB NOT NULL,
    updated_counts JSONB NOT NULL,
    warnings JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_part_merge_log_keep_part ON part_merge_log(keep_part_id);
CREATE INDEX idx_part_merge_log_merged_part ON part_merge_log(merged_part_id);
CREATE INDEX idx_part_merge_log_merged_at ON part_merge_log(merged_at);
CREATE INDEX idx_part_merge_log_actor ON part_merge_log(actor_employee_id);

-- Comments for documentation
COMMENT ON TABLE part_merge_log IS 'Audit trail of part merge operations';
COMMENT ON COLUMN part_merge_log.field_overrides IS 'JSON object of field-level choices made during merge';
COMMENT ON COLUMN part_merge_log.merge_rules IS 'JSON object of merge rules applied (merge_numbers, merge_applications, etc.)';
COMMENT ON COLUMN part_merge_log.updated_counts IS 'JSON object with counts of updated records by table';
COMMENT ON COLUMN part_merge_log.warnings IS 'JSON array of warnings generated during merge';
