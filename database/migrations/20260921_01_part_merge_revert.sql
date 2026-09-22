-- A merge is reversible for 24 hours.  The audit log remains permanent; these
-- snapshots are the short-lived, exact before-images required for a safe undo.
CREATE TABLE IF NOT EXISTS part_merge_operation (
    operation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_employee_id BIGINT NOT NULL REFERENCES employee(employee_id),
    keep_part_id BIGINT NOT NULL REFERENCES part(part_id),
    merged_part_ids BIGINT[] NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    undo_expires_at TIMESTAMPTZ NOT NULL,
    reverted_at TIMESTAMPTZ,
    reverted_by_employee_id BIGINT REFERENCES employee(employee_id),
    revert_reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'reverted', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_part_merge_operation_revertable
    ON part_merge_operation (status, undo_expires_at)
    WHERE status = 'active';

CREATE TABLE IF NOT EXISTS part_merge_snapshot (
    operation_id UUID NOT NULL REFERENCES part_merge_operation(operation_id) ON DELETE CASCADE,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    before_image JSONB NOT NULL,
    PRIMARY KEY (operation_id, table_name, record_id)
);

CREATE INDEX IF NOT EXISTS idx_part_merge_snapshot_expiry
    ON part_merge_snapshot (operation_id);

INSERT INTO permission (permission_key, description, category)
VALUES ('parts:merge_revert', 'Revert a part merge during its approved undo window', 'Parts')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl
CROSS JOIN permission p
WHERE pl.level_name IN ('Admin', 'Manager')
  AND p.permission_key = 'parts:merge_revert'
ON CONFLICT DO NOTHING;

-- All catalog and inventory writers participate in the same lock protocol as
-- PartMergeService. This prevents a child write from slipping into a merge
-- after the service has taken its part-row locks.
CREATE OR REPLACE FUNCTION lock_part_merge_rows()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    record_json JSONB;
    candidate TEXT;
BEGIN
    FOREACH record_json IN ARRAY ARRAY[
        CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
        CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
    ]
    LOOP
        IF record_json IS NULL THEN CONTINUE; END IF;
        FOR candidate IN
            SELECT value
            FROM (
                SELECT DISTINCT value, value::bigint AS lock_id
                FROM unnest(ARRAY[
                    record_json ->> 'part_id',
                    record_json ->> 'source_part_id',
                    record_json ->> 'part_id_1',
                    record_json ->> 'part_id_2'
                ]) AS value
                WHERE value IS NOT NULL
            ) locks
            ORDER BY lock_id
        LOOP
            PERFORM pg_advisory_xact_lock(candidate::bigint);
        END LOOP;
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    target_table TEXT;
BEGIN
    FOREACH target_table IN ARRAY ARRAY[
        'part', 'part_number', 'part_application', 'part_barcode', 'part_tag',
        'part_inventory_stats', 'part_aliases', 'staged_sale_line',
        'dedupe_scan_queue', 'ai_match_cache', 'ai_verification_queue',
        'part_exclusion', 'inventory_transaction'
    ]
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS part_merge_advisory_lock ON %I', target_table);
        EXECUTE format(
            'CREATE TRIGGER part_merge_advisory_lock BEFORE INSERT OR UPDATE OR DELETE ON %I '
            || 'FOR EACH ROW EXECUTE FUNCTION lock_part_merge_rows()',
            target_table
        );
    END LOOP;
END;
$$;
