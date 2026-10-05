-- Phase 1: retirement invariants, audit storage and write serialization.
-- The FK policy registry in packages/api/services/masterDataMergePolicy.js is
-- checked against the live catalog by the database integration test.

ALTER TABLE public.brand ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT TRUE;
ALTER TABLE public."group" ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT TRUE;
UPDATE public.brand SET is_active = FALSE WHERE is_merged AND is_active;
UPDATE public."group" SET is_active = FALSE WHERE is_merged AND is_active;
UPDATE public.supplier SET is_active = FALSE WHERE is_merged AND is_active IS DISTINCT FROM FALSE;
UPDATE public.customer SET is_active = FALSE WHERE is_merged AND is_active IS DISTINCT FROM FALSE;
ALTER TABLE public.supplier ALTER COLUMN is_active SET DEFAULT TRUE;
ALTER TABLE public.customer ALTER COLUMN is_active SET DEFAULT TRUE;
UPDATE public.supplier SET is_active = TRUE WHERE is_active IS NULL;
UPDATE public.customer SET is_active = TRUE WHERE is_active IS NULL;
ALTER TABLE public.supplier ALTER COLUMN is_active SET NOT NULL;
ALTER TABLE public.customer ALTER COLUMN is_active SET NOT NULL;

ALTER TABLE public.brand DROP CONSTRAINT IF EXISTS chk_brand_merge_state;
ALTER TABLE public.brand ADD CONSTRAINT chk_brand_merge_state CHECK (
    (is_merged AND merged_into_brand_id IS NOT NULL AND NOT is_active)
    OR (NOT is_merged AND merged_into_brand_id IS NULL)
);
ALTER TABLE public.brand DROP CONSTRAINT IF EXISTS chk_brand_merge_not_self;
ALTER TABLE public.brand ADD CONSTRAINT chk_brand_merge_not_self CHECK (merged_into_brand_id IS DISTINCT FROM brand_id);
ALTER TABLE public."group" DROP CONSTRAINT IF EXISTS chk_group_merge_state;
ALTER TABLE public."group" ADD CONSTRAINT chk_group_merge_state CHECK (
    (is_merged AND merged_into_group_id IS NOT NULL AND NOT is_active)
    OR (NOT is_merged AND merged_into_group_id IS NULL)
);
ALTER TABLE public."group" DROP CONSTRAINT IF EXISTS chk_group_merge_not_self;
ALTER TABLE public."group" ADD CONSTRAINT chk_group_merge_not_self CHECK (merged_into_group_id IS DISTINCT FROM group_id);
ALTER TABLE public.supplier DROP CONSTRAINT IF EXISTS chk_supplier_merge_state;
ALTER TABLE public.supplier ADD CONSTRAINT chk_supplier_merge_state CHECK (
    (is_merged AND merged_into_supplier_id IS NOT NULL AND NOT is_active)
    OR (NOT is_merged AND merged_into_supplier_id IS NULL)
);
ALTER TABLE public.supplier DROP CONSTRAINT IF EXISTS chk_supplier_merge_not_self;
ALTER TABLE public.supplier ADD CONSTRAINT chk_supplier_merge_not_self CHECK (merged_into_supplier_id IS DISTINCT FROM supplier_id);
ALTER TABLE public.customer DROP CONSTRAINT IF EXISTS chk_customer_merge_state;
ALTER TABLE public.customer ADD CONSTRAINT chk_customer_merge_state CHECK (
    (is_merged AND merged_into_customer_id IS NOT NULL AND NOT is_active)
    OR (NOT is_merged AND merged_into_customer_id IS NULL)
);
ALTER TABLE public.customer DROP CONSTRAINT IF EXISTS chk_customer_merge_not_self;
ALTER TABLE public.customer ADD CONSTRAINT chk_customer_merge_not_self CHECK (merged_into_customer_id IS DISTINCT FROM customer_id);

CREATE TABLE IF NOT EXISTS public.supplier_alias (
    supplier_alias_id bigserial PRIMARY KEY,
    supplier_id integer NOT NULL REFERENCES public.supplier(supplier_id) ON DELETE RESTRICT,
    alias_name varchar(255) NOT NULL,
    alias_code varchar(30),
    source_supplier_id integer REFERENCES public.supplier(supplier_id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(alias_name) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_alias_owner_name
    ON public.supplier_alias (supplier_id, lower(btrim(alias_name)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_alias_owner_code
    ON public.supplier_alias (supplier_id, lower(btrim(alias_code))) WHERE alias_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_alias_name ON public.supplier_alias (lower(btrim(alias_name)));
CREATE INDEX IF NOT EXISTS idx_supplier_alias_code ON public.supplier_alias (lower(btrim(alias_code))) WHERE alias_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.customer_alias (
    customer_alias_id bigserial PRIMARY KEY,
    customer_id integer NOT NULL REFERENCES public.customer(customer_id) ON DELETE RESTRICT,
    alias_name varchar(255) NOT NULL,
    alias_code varchar(30),
    source_customer_id integer REFERENCES public.customer(customer_id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(alias_name) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_alias_owner_name
    ON public.customer_alias (customer_id, lower(btrim(alias_name)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_alias_owner_code
    ON public.customer_alias (customer_id, lower(btrim(alias_code))) WHERE alias_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_alias_name ON public.customer_alias (lower(btrim(alias_name)));
CREATE INDEX IF NOT EXISTS idx_customer_alias_code ON public.customer_alias (lower(btrim(alias_code))) WHERE alias_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.master_data_merge_operation (
    operation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type text NOT NULL CHECK (entity_type IN ('supplier', 'customer', 'brand', 'group')),
    canonical_id integer NOT NULL CHECK (canonical_id > 0),
    source_ids integer[] NOT NULL CHECK (cardinality(source_ids) > 0),
    actor_employee_id integer NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    undo_expires_at timestamptz NOT NULL,
    reverted_at timestamptz,
    reverted_by_employee_id integer REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    revert_reason text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'reverted', 'expired')),
    impact jsonb NOT NULL DEFAULT '{}'::jsonb,
    decisions jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_master_data_merge_operation_history
    ON public.master_data_merge_operation (entity_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_master_data_merge_operation_revertable
    ON public.master_data_merge_operation (undo_expires_at) WHERE status = 'active';
CREATE TABLE IF NOT EXISTS public.master_data_merge_snapshot (
    operation_id uuid NOT NULL REFERENCES public.master_data_merge_operation(operation_id) ON DELETE CASCADE,
    table_name text NOT NULL,
    record_id text NOT NULL,
    before_image jsonb NOT NULL,
    PRIMARY KEY (operation_id, table_name, record_id)
);

-- Two-int advisory locks give each entity an independent ID space.
CREATE OR REPLACE FUNCTION public.master_data_merge_namespace(entity_name text)
RETURNS integer LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT CASE entity_name
        WHEN 'supplier' THEN 730001 WHEN 'customer' THEN 730002
        WHEN 'brand' THEN 730003 WHEN 'group' THEN 730004
    END
$$;

CREATE OR REPLACE FUNCTION public.guard_master_data_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    entity_name text := TG_ARGV[0];
    key_name text := TG_ARGV[1];
    record_id integer;
BEGIN
    record_id := COALESCE((to_jsonb(NEW) ->> key_name)::integer, (to_jsonb(OLD) ->> key_name)::integer);
    PERFORM pg_advisory_xact_lock(public.master_data_merge_namespace(entity_name), record_id);
    IF TG_OP = 'UPDATE' AND OLD.is_merged AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
        RAISE EXCEPTION 'Merged % % is read-only', entity_name, record_id USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' AND OLD.is_merged THEN
        RAISE EXCEPTION 'Merged % % cannot be deleted', entity_name, record_id USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.guard_master_data_reference()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    entity_name text := TG_ARGV[0];
    key_name text := TG_ARGV[1];
    owner_table text := CASE WHEN entity_name = 'group' THEN '"group"' ELSE entity_name END;
    old_id integer;
    new_id integer;
    candidate integer;
    healthy boolean;
BEGIN
    IF TG_OP <> 'INSERT' THEN old_id := (to_jsonb(OLD) ->> key_name)::integer; END IF;
    IF TG_OP <> 'DELETE' THEN new_id := (to_jsonb(NEW) ->> key_name)::integer; END IF;
    IF TG_OP = 'UPDATE' AND new_id IS NOT DISTINCT FROM old_id THEN RETURN NEW; END IF;
    FOR candidate IN SELECT DISTINCT value FROM unnest(ARRAY[old_id, new_id]) AS value
                     WHERE value IS NOT NULL ORDER BY value LOOP
        PERFORM pg_advisory_xact_lock(public.master_data_merge_namespace(entity_name), candidate);
    END LOOP;
    IF new_id IS NOT NULL AND (TG_OP = 'INSERT' OR new_id IS DISTINCT FROM old_id) THEN
        EXECUTE format('SELECT is_active AND NOT is_merged FROM public.%s WHERE %I = $1 FOR SHARE', owner_table, entity_name || '_id')
            INTO healthy USING new_id;
        IF healthy IS NOT TRUE THEN
            RAISE EXCEPTION 'Cannot reference inactive or merged % %', entity_name, new_id USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

-- Attach the guard to every operational FK in the current catalog. Provenance
-- and duplicate suggestions have their own lifecycle in the merge engine.
DO $$
DECLARE
    ref record;
    trigger_name text;
BEGIN
    FOR ref IN
        SELECT child.relname AS child_table, parent.relname AS entity_name,
               attribute.attname AS column_name
        FROM pg_constraint fk
        JOIN pg_class child ON child.oid = fk.conrelid
        JOIN pg_namespace child_schema ON child_schema.oid = child.relnamespace
        JOIN pg_class parent ON parent.oid = fk.confrelid
        JOIN pg_namespace parent_schema ON parent_schema.oid = parent.relnamespace
        JOIN pg_attribute attribute ON attribute.attrelid = child.oid AND attribute.attnum = fk.conkey[1]
        WHERE fk.contype = 'f' AND cardinality(fk.conkey) = 1
          AND child_schema.nspname = 'public' AND parent_schema.nspname = 'public'
          AND parent.relname IN ('supplier', 'customer', 'brand', 'group')
          AND NOT (child.relname = parent.relname AND attribute.attname LIKE 'merged_into_%')
          AND child.relname NOT LIKE '%_duplicate_suggestion'
          AND attribute.attname NOT LIKE 'source_%'
    LOOP
        trigger_name := 'master_merge_guard_' || ref.column_name;
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trigger_name, ref.child_table);
        EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
            || 'FOR EACH ROW EXECUTE FUNCTION public.guard_master_data_reference(%L, %L)',
            trigger_name, ref.child_table, ref.entity_name, ref.column_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)',
            'idx_master_merge_' || ref.child_table || '_' || ref.column_name, ref.child_table, ref.column_name);
    END LOOP;
END $$;

DO $$
DECLARE entity_name text;
DECLARE key_name text;
BEGIN
    FOREACH entity_name IN ARRAY ARRAY['supplier', 'customer', 'brand', 'group'] LOOP
        key_name := entity_name || '_id';
        EXECUTE format('DROP TRIGGER IF EXISTS master_merge_master_guard ON public.%I', entity_name);
        EXECUTE format('CREATE TRIGGER master_merge_master_guard BEFORE UPDATE OR DELETE ON public.%I '
            || 'FOR EACH ROW EXECUTE FUNCTION public.guard_master_data_write(%L, %L)', entity_name, entity_name, key_name);
    END LOOP;
END $$;
