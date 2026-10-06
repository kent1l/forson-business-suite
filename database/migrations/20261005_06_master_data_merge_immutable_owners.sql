-- Permit only the exact, snapshotted ownership move (or its guarded revert)
-- through the finance immutability triggers. Ordinary edits remain rejected.
CREATE OR REPLACE FUNCTION public.master_data_merge_owner_move_allowed(
    relation_name text, owner_column text, old_row jsonb, new_row jsonb)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
    merge_id text := nullif(current_setting('master_data_merge.operation', true), '');
    revert_id text := nullif(current_setting('master_data_merge.revert_operation', true), '');
    entity_name text;
    key_column text;
    permitted boolean := false;
BEGIN
    IF relation_name = 'ap_ledger' AND owner_column = 'supplier_id' THEN
        entity_name := 'supplier'; key_column := 'ledger_id';
    ELSIF relation_name = 'ar_ledger' AND owner_column = 'customer_id' THEN
        entity_name := 'customer'; key_column := 'ledger_id';
    ELSIF relation_name = 'ar_adjustment' AND owner_column = 'customer_id' THEN
        entity_name := 'customer'; key_column := 'adjustment_id';
    ELSE
        RETURN false;
    END IF;
    IF old_row ->> owner_column IS NULL OR new_row ->> owner_column IS NULL
       OR old_row ->> key_column IS NULL
       OR old_row ->> owner_column = new_row ->> owner_column
       OR old_row - owner_column IS DISTINCT FROM new_row - owner_column THEN
        RETURN false;
    END IF;
    IF merge_id IS NOT NULL AND merge_id ~ '^[0-9a-f-]{36}$' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.master_data_merge_operation operation
            JOIN public.master_data_merge_snapshot snapshot
              ON snapshot.operation_id = operation.operation_id
            WHERE operation.operation_id = merge_id::uuid AND operation.entity_type = entity_name
              AND operation.status = 'pending'
              AND (old_row ->> owner_column)::integer = ANY(operation.source_ids)
              AND (new_row ->> owner_column)::integer = operation.canonical_id
              AND snapshot.table_name = relation_name
              AND snapshot.record_id = jsonb_build_array((old_row ->> key_column)::bigint)::text
              AND snapshot.before_image = old_row
        ) INTO permitted;
    END IF;
    IF permitted THEN RETURN true; END IF;
    IF revert_id IS NOT NULL AND revert_id ~ '^[0-9a-f-]{36}$' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.master_data_merge_operation operation
            JOIN public.master_data_merge_snapshot snapshot
              ON snapshot.operation_id = operation.operation_id
            WHERE operation.operation_id = revert_id::uuid AND operation.entity_type = entity_name
              AND operation.status = 'active'
              AND (old_row ->> owner_column)::integer = operation.canonical_id
              AND (new_row ->> owner_column)::integer = ANY(operation.source_ids)
              AND snapshot.table_name = relation_name
              AND snapshot.record_id = jsonb_build_array((old_row ->> key_column)::bigint)::text
              AND snapshot.after_image = old_row AND snapshot.before_image = new_row
        ) INTO permitted;
    END IF;
    RETURN permitted;
END $$;

CREATE OR REPLACE FUNCTION public.ap_ledger_immutability_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF public.master_data_merge_owner_move_allowed('ap_ledger', 'supplier_id', to_jsonb(OLD), to_jsonb(NEW)) THEN
            RETURN NEW;
        END IF;
        IF NEW.ledger_id       IS DISTINCT FROM OLD.ledger_id       OR
           NEW.supplier_id     IS DISTINCT FROM OLD.supplier_id     OR
           NEW.bill_id         IS DISTINCT FROM OLD.bill_id         OR
           NEW.payment_id      IS DISTINCT FROM OLD.payment_id      OR
           NEW.entry_type      IS DISTINCT FROM OLD.entry_type      OR
           NEW.amount          IS DISTINCT FROM OLD.amount          OR
           NEW.balance_after   IS DISTINCT FROM OLD.balance_after   OR
           NEW.payment_channel IS DISTINCT FROM OLD.payment_channel OR
           NEW.reference_no    IS DISTINCT FROM OLD.reference_no    OR
           NEW.notes           IS DISTINCT FROM OLD.notes           OR
           NEW.created_at      IS DISTINCT FROM OLD.created_at      OR
           NEW.created_by      IS DISTINCT FROM OLD.created_by THEN
            RAISE EXCEPTION 'ap_ledger rows are immutable — only entry_date may be corrected';
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'ap_ledger rows are immutable — UPDATE/DELETE not permitted';
END $$;

CREATE OR REPLACE FUNCTION public.ar_ledger_immutability_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF public.master_data_merge_owner_move_allowed('ar_ledger', 'customer_id', to_jsonb(OLD), to_jsonb(NEW)) THEN
            RETURN NEW;
        END IF;
        IF NEW.ledger_id       IS DISTINCT FROM OLD.ledger_id       OR
           NEW.customer_id     IS DISTINCT FROM OLD.customer_id     OR
           NEW.invoice_id      IS DISTINCT FROM OLD.invoice_id      OR
           NEW.payment_id      IS DISTINCT FROM OLD.payment_id      OR
           NEW.cn_id           IS DISTINCT FROM OLD.cn_id           OR
           NEW.entry_type      IS DISTINCT FROM OLD.entry_type      OR
           NEW.amount          IS DISTINCT FROM OLD.amount          OR
           NEW.balance_after   IS DISTINCT FROM OLD.balance_after   OR
           NEW.payment_channel IS DISTINCT FROM OLD.payment_channel OR
           NEW.reference_no    IS DISTINCT FROM OLD.reference_no    OR
           NEW.notes           IS DISTINCT FROM OLD.notes           OR
           NEW.created_at      IS DISTINCT FROM OLD.created_at      OR
           NEW.created_by      IS DISTINCT FROM OLD.created_by      OR
           NEW.payment_source  IS DISTINCT FROM OLD.payment_source THEN
            RAISE EXCEPTION 'ar_ledger rows are immutable — only entry_date may be corrected';
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'ar_ledger rows are immutable — UPDATE/DELETE not permitted';
END $$;

CREATE OR REPLACE FUNCTION public.ar_adjustment_immutability_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'ar_adjustment rows cannot be deleted — reverse the adjustment instead';
    END IF;
    IF public.master_data_merge_owner_move_allowed('ar_adjustment', 'customer_id', to_jsonb(OLD), to_jsonb(NEW)) THEN
        RETURN NEW;
    END IF;
    IF NEW.adjustment_no          IS DISTINCT FROM OLD.adjustment_no
    OR NEW.customer_id            IS DISTINCT FROM OLD.customer_id
    OR NEW.adjustment_type        IS DISTINCT FROM OLD.adjustment_type
    OR NEW.reason_code            IS DISTINCT FROM OLD.reason_code
    OR NEW.total_amount           IS DISTINCT FROM OLD.total_amount
    OR NEW.granted_by             IS DISTINCT FROM OLD.granted_by
    OR NEW.authorized_by          IS DISTINCT FROM OLD.authorized_by
    OR NEW.authorization_method   IS DISTINCT FROM OLD.authorization_method
    OR NEW.client_ref             IS DISTINCT FROM OLD.client_ref
    OR NEW.created_at             IS DISTINCT FROM OLD.created_at
    OR NEW.reverses_adjustment_id IS DISTINCT FROM OLD.reverses_adjustment_id THEN
        RAISE EXCEPTION 'ar_adjustment % is immutable — post a reversing adjustment instead of editing it', OLD.adjustment_no;
    END IF;
    IF OLD.ledger_id IS NOT NULL AND NEW.ledger_id IS DISTINCT FROM OLD.ledger_id THEN
        RAISE EXCEPTION 'ar_adjustment % is already linked to ledger entry % ', OLD.adjustment_no, OLD.ledger_id;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT ((OLD.status = 'PENDING_CLEARANCE' AND NEW.status IN ('POSTED', 'VOIDED'))
             OR (OLD.status = 'POSTED' AND NEW.status = 'REVERSED')) THEN
            RAISE EXCEPTION 'ar_adjustment % cannot move from % to %', OLD.adjustment_no, OLD.status, NEW.status;
        END IF;
    END IF;
    RETURN NEW;
END $$;
