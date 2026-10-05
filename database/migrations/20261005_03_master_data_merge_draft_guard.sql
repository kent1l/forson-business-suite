-- Serialize saved server drafts with master-data merges. Typed paths mirror
-- MasterDataMergeService's version-1 draft registry; unknown versions are
-- rejected by the merge preview before execution.
CREATE OR REPLACE FUNCTION public.guard_master_data_draft()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    entity_name text;
    owner_table text;
    field_name text;
    json_path jsonpath;
    candidate integer;
    healthy boolean;
    old_data jsonb;
BEGIN
    old_data := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE OLD.draft_data END;
    FOR entity_name, owner_table IN
        SELECT * FROM (VALUES ('supplier', 'supplier'), ('customer', 'customer')) AS owners(entity_name, owner_table)
    LOOP
        FOR candidate IN
            SELECT DISTINCT (entry #>> '{}')::integer
            FROM (
                SELECT jsonb_path_query(old_data, format('$.**.%s', fields.field_name)::jsonpath) AS entry
                FROM unnest(CASE WHEN entity_name = 'supplier'
                    THEN ARRAY['supplier_id', 'supplierId', 'selectedSupplier', 'freight_supplier_id', 'freightSupplierId']
                    ELSE ARRAY['customer_id', 'customerId', 'selectedCustomer'] END) AS fields(field_name)
                UNION ALL
                SELECT jsonb_path_query(NEW.draft_data, format('$.**.%s', fields.field_name)::jsonpath) AS entry
                FROM unnest(CASE WHEN entity_name = 'supplier'
                    THEN ARRAY['supplier_id', 'supplierId', 'selectedSupplier', 'freight_supplier_id', 'freightSupplierId']
                    ELSE ARRAY['customer_id', 'customerId', 'selectedCustomer'] END) AS fields(field_name)
            ) candidates
            WHERE entry #>> '{}' ~ '^[0-9]+$'
            ORDER BY 1
        LOOP
            PERFORM pg_advisory_xact_lock(public.master_data_merge_namespace(entity_name), candidate);
        END LOOP;
        FOR field_name IN
            SELECT unnest(CASE WHEN entity_name = 'supplier'
                THEN ARRAY['supplier_id', 'supplierId', 'selectedSupplier', 'freight_supplier_id', 'freightSupplierId']
                ELSE ARRAY['customer_id', 'customerId', 'selectedCustomer'] END)
        LOOP
            json_path := format('$.**.%s', field_name)::jsonpath;
            FOR candidate IN
                SELECT DISTINCT (entry #>> '{}')::integer
                FROM jsonb_path_query(NEW.draft_data, json_path) AS entry
                WHERE entry #>> '{}' ~ '^[0-9]+$'
            LOOP
                EXECUTE format('SELECT is_active AND NOT is_merged FROM public.%I WHERE %I = $1 FOR SHARE',
                    owner_table, entity_name || '_id') INTO healthy USING candidate;
                IF healthy IS NOT TRUE THEN
                    RAISE EXCEPTION 'Draft references inactive or merged % %', entity_name, candidate USING ERRCODE = '23514';
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS master_merge_draft_guard ON public.draft_transaction;
CREATE TRIGGER master_merge_draft_guard BEFORE INSERT OR UPDATE OF draft_data, expires_at, transaction_type ON public.draft_transaction
    FOR EACH ROW EXECUTE FUNCTION public.guard_master_data_draft();
