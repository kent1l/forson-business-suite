-- A revert compares every affected row with its exact post-merge image.
-- Rows created by a merge have a NULL before_image; rows removed by a merge
-- have a NULL after_image. Older operations without complete after-images are
-- deliberately ineligible for automatic revert.
ALTER TABLE public.master_data_merge_snapshot
    ADD COLUMN IF NOT EXISTS after_image jsonb;
ALTER TABLE public.master_data_merge_snapshot
    ALTER COLUMN before_image DROP NOT NULL;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_master_data_merge_snapshot_image'
                   AND conrelid = 'public.master_data_merge_snapshot'::regclass) THEN
        ALTER TABLE public.master_data_merge_snapshot
            ADD CONSTRAINT chk_master_data_merge_snapshot_image
            CHECK (before_image IS NOT NULL OR after_image IS NOT NULL);
    END IF;
END $$;

-- The existing master guard remains in force. Only a transaction restoring an
-- active operation to its exact recorded before-image may unretire a source.
CREATE OR REPLACE FUNCTION public.guard_master_data_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    entity_name text := TG_ARGV[0];
    key_name text := TG_ARGV[1];
    master_id integer;
    revert_id text := current_setting('master_data_merge.revert_operation', true);
    allowed boolean := false;
BEGIN
    master_id := COALESCE((to_jsonb(NEW) ->> key_name)::integer, (to_jsonb(OLD) ->> key_name)::integer);
    PERFORM pg_advisory_xact_lock(public.master_data_merge_namespace(entity_name), master_id);
    IF TG_OP = 'UPDATE' AND OLD.is_merged AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
        IF revert_id IS NOT NULL AND revert_id ~ '^[0-9a-f-]{36}$' THEN
            SELECT EXISTS (
                SELECT 1 FROM public.master_data_merge_operation operation
                JOIN public.master_data_merge_snapshot snapshot
                  ON snapshot.operation_id = operation.operation_id
                WHERE operation.operation_id = revert_id::uuid
                  AND operation.entity_type = entity_name
                  AND operation.status = 'active'
                  AND snapshot.table_name = entity_name
                  AND snapshot.record_id = jsonb_build_array(master_id)::text
                  AND snapshot.before_image = to_jsonb(NEW)
            ) INTO allowed;
        END IF;
        IF NOT allowed THEN
            RAISE EXCEPTION 'Merged % % is read-only', entity_name, master_id USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' AND OLD.is_merged THEN
        RAISE EXCEPTION 'Merged % % cannot be deleted', entity_name, master_id USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
