-- Flatten legacy provenance chains before enforcing direct, healthy targets.
-- Only merged_into_* changes; no master, document, or alias is deleted.
DO $$
DECLARE
    entity_name text;
    key_name text;
    target_name text;
    changed integer;
    broken integer;
    passes integer;
BEGIN
    FOREACH entity_name IN ARRAY ARRAY['supplier', 'customer', 'brand', 'group'] LOOP
        key_name := entity_name || '_id';
        target_name := 'merged_into_' || key_name;
        EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER master_merge_master_guard', entity_name);
        EXECUTE format(
            'UPDATE public.master_data_merge_operation operation SET decisions = '
            || 'operation.decisions || ''{"tombstoneRedirectsNotSnapshotted":true}''::jsonb '
            || 'WHERE operation.entity_type = $1 AND operation.status = ''active'' AND EXISTS ('
            || 'SELECT 1 FROM public.%I child WHERE child.is_merged AND child.%I = ANY(operation.source_ids))',
            entity_name, target_name) USING entity_name;
        passes := 0;
        LOOP
            EXECUTE format(
                'UPDATE public.%I child SET %I = parent.%I FROM public.%I parent '
                || 'WHERE child.is_merged AND parent.is_merged AND child.%I = parent.%I '
                || 'AND parent.%I IS NOT NULL AND child.%I <> parent.%I',
                entity_name, target_name, target_name, entity_name,
                target_name, key_name, target_name, key_name, target_name);
            GET DIAGNOSTICS changed = ROW_COUNT;
            EXIT WHEN changed = 0;
            passes := passes + 1;
            IF passes > 1000 THEN RAISE EXCEPTION 'Merge chain repair exceeded 1000 passes for %', entity_name; END IF;
        END LOOP;
        EXECUTE format(
            'SELECT COUNT(*) FROM public.%I child LEFT JOIN public.%I target ON target.%I = child.%I '
            || 'WHERE child.is_merged AND (target.%I IS NULL OR target.is_merged OR target.is_active IS DISTINCT FROM TRUE)',
            entity_name, entity_name, key_name, target_name, key_name) INTO broken;
        IF broken <> 0 THEN RAISE EXCEPTION 'Unresolved merge chain or unhealthy target for %: % rows', entity_name, broken; END IF;
        EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER master_merge_master_guard', entity_name);
    END LOOP;
END $$;

-- A retired tombstone can be redirected only by the exact snapshotted merge or
-- its guarded revert. Retiring or deactivating a target with inbound tombstones
-- requires redirecting those tombstones first in the same transaction.
CREATE OR REPLACE FUNCTION public.guard_master_data_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    entity_name text := TG_ARGV[0];
    key_name text := TG_ARGV[1];
    target_name text := 'merged_into_' || TG_ARGV[1];
    master_id integer;
    old_image jsonb;
    new_image jsonb;
    merge_id text := nullif(current_setting('master_data_merge.operation', true), '');
    revert_id text := nullif(current_setting('master_data_merge.revert_operation', true), '');
    allowed boolean := false;
    has_inbound boolean := false;
BEGIN
    master_id := COALESCE((to_jsonb(NEW) ->> key_name)::integer, (to_jsonb(OLD) ->> key_name)::integer);
    PERFORM pg_advisory_xact_lock(public.master_data_merge_namespace(entity_name), master_id);
    IF TG_OP = 'DELETE' THEN
        IF OLD.is_merged THEN
            RAISE EXCEPTION 'Merged % % cannot be deleted', entity_name, master_id USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    old_image := to_jsonb(OLD);
    new_image := to_jsonb(NEW);
    IF OLD.is_merged AND new_image IS DISTINCT FROM old_image THEN
        IF merge_id IS NOT NULL AND merge_id ~ '^[0-9a-f-]{36}$'
           AND NEW.is_merged AND NOT NEW.is_active
           AND old_image - target_name = new_image - target_name THEN
            SELECT EXISTS (
                SELECT 1 FROM public.master_data_merge_operation operation
                JOIN public.master_data_merge_snapshot snapshot ON snapshot.operation_id = operation.operation_id
                WHERE operation.operation_id = merge_id::uuid AND operation.entity_type = entity_name
                  AND operation.status = 'pending'
                  AND (old_image ->> target_name)::integer = ANY(operation.source_ids)
                  AND (new_image ->> target_name)::integer = operation.canonical_id
                  AND snapshot.table_name = entity_name
                  AND snapshot.record_id = jsonb_build_array(master_id)::text
                  AND snapshot.before_image = old_image
            ) INTO allowed;
        END IF;
        IF NOT allowed AND revert_id IS NOT NULL AND revert_id ~ '^[0-9a-f-]{36}$' THEN
            SELECT EXISTS (
                SELECT 1 FROM public.master_data_merge_operation operation
                JOIN public.master_data_merge_snapshot snapshot ON snapshot.operation_id = operation.operation_id
                WHERE operation.operation_id = revert_id::uuid AND operation.entity_type = entity_name
                  AND operation.status = 'active' AND snapshot.table_name = entity_name
                  AND snapshot.record_id = jsonb_build_array(master_id)::text
                  AND snapshot.after_image = old_image AND snapshot.before_image = new_image
            ) INTO allowed;
        END IF;
        IF NOT allowed THEN
            RAISE EXCEPTION 'Merged % % is read-only', entity_name, master_id USING ERRCODE = '23514';
        END IF;
    END IF;
    IF OLD.is_active AND NEW.is_active IS DISTINCT FROM TRUE THEN
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I child WHERE child.is_merged AND child.%I = $1)',
            entity_name, target_name) INTO has_inbound USING master_id;
        IF has_inbound THEN
            RAISE EXCEPTION 'Cannot retire % % while merged sources still point to it', entity_name, master_id
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END $$;
