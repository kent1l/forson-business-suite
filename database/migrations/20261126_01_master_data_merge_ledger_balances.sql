-- Recompute ar_ledger / ap_ledger running balances (balance_after) during
-- master-data merges/reverts and derive future balance_after from SUM(amount)
-- so interleaved ledger histories never drift.

CREATE OR REPLACE FUNCTION public.master_data_merge_owner_move_allowed(
    relation_name text, owner_column text, old_row jsonb, new_row jsonb)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
    merge_id text := nullif(current_setting('master_data_merge.operation', true), '');
    revert_id text := nullif(current_setting('master_data_merge.revert_operation', true), '');
    entity_name text;
    key_column text;
    is_ledger boolean := false;
    permitted boolean := false;
BEGIN
    IF relation_name = 'ap_ledger' AND owner_column = 'supplier_id' THEN
        entity_name := 'supplier'; key_column := 'ledger_id'; is_ledger := true;
    ELSIF relation_name = 'ar_ledger' AND owner_column = 'customer_id' THEN
        entity_name := 'customer'; key_column := 'ledger_id'; is_ledger := true;
    ELSIF relation_name = 'ar_adjustment' AND owner_column = 'customer_id' THEN
        entity_name := 'customer'; key_column := 'adjustment_id';
    ELSE
        RETURN false;
    END IF;

    IF old_row ->> owner_column IS NULL OR new_row ->> owner_column IS NULL
       OR old_row ->> key_column IS NULL THEN
        RETURN false;
    END IF;

    IF is_ledger THEN
        IF old_row IS NOT DISTINCT FROM new_row
           OR (old_row - owner_column - 'balance_after') IS DISTINCT FROM (new_row - owner_column - 'balance_after') THEN
            RETURN false;
        END IF;
    ELSE
        IF old_row ->> owner_column = new_row ->> owner_column
           OR old_row - owner_column IS DISTINCT FROM new_row - owner_column THEN
            RETURN false;
        END IF;
    END IF;

    IF merge_id IS NOT NULL AND merge_id ~ '^[0-9a-f-]{36}$' THEN
        IF is_ledger THEN
            SELECT EXISTS (
                SELECT 1 FROM public.master_data_merge_operation operation
                JOIN public.master_data_merge_snapshot snapshot
                  ON snapshot.operation_id = operation.operation_id
                WHERE operation.operation_id = merge_id::uuid AND operation.entity_type = entity_name
                  AND operation.status = 'pending'
                  AND (old_row ->> owner_column)::integer = ANY(operation.source_ids || operation.canonical_id)
                  AND (new_row ->> owner_column)::integer = operation.canonical_id
                  AND snapshot.table_name = relation_name
                  AND snapshot.record_id = jsonb_build_array((old_row ->> key_column)::bigint)::text
                  AND snapshot.before_image = old_row
            ) INTO permitted;
        ELSE
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
    END IF;
    IF permitted THEN RETURN true; END IF;

    IF revert_id IS NOT NULL AND revert_id ~ '^[0-9a-f-]{36}$' THEN
        IF is_ledger THEN
            SELECT EXISTS (
                SELECT 1 FROM public.master_data_merge_operation operation
                JOIN public.master_data_merge_snapshot snapshot
                  ON snapshot.operation_id = operation.operation_id
                WHERE operation.operation_id = revert_id::uuid AND operation.entity_type = entity_name
                  AND operation.status = 'active'
                  AND (old_row ->> owner_column)::integer = operation.canonical_id
                  AND (new_row ->> owner_column)::integer = ANY(operation.source_ids || operation.canonical_id)
                  AND snapshot.table_name = relation_name
                  AND snapshot.record_id = jsonb_build_array((old_row ->> key_column)::bigint)::text
                  AND snapshot.after_image = old_row AND snapshot.before_image = new_row
            ) INTO permitted;
        ELSE
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
    END IF;
    RETURN permitted;
END $$;

CREATE OR REPLACE FUNCTION public.append_ar_ledger_entry(
    p_customer_id integer,
    p_invoice_id integer,
    p_payment_id integer,
    p_cn_id integer,
    p_entry_type ar_ledger_entry_type,
    p_amount numeric,
    p_payment_channel character varying,
    p_reference_no character varying,
    p_notes text,
    p_created_by integer,
    p_payment_source character varying DEFAULT NULL::character varying,
    p_entry_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP
) RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
    v_prev_balance  numeric(12,2);
    v_ledger_id     bigint;
BEGIN
    PERFORM pg_advisory_xact_lock(public.master_data_merge_namespace('customer'), p_customer_id);
    PERFORM pg_advisory_xact_lock(hashtext('ar_ledger:' || p_customer_id::text));

    -- Idempotency short-circuit: a given payment posts at most one entry of each
    -- settlement type, so this is safe to call more than once for the same payment
    -- (once from the safety-net trigger, once from application code).
    --
    -- Deliberately NOT "one settlement entry per payment": a customer_payment
    -- collected net of tax legitimately posts one PAYMENT_SETTLED for the cash and
    -- one WITHHOLDING_TAX_CREDIT for the deduction, against the same payment_id.
    -- Those are two funding components of one payment, not a duplicate.
    IF p_payment_id IS NOT NULL
       AND p_entry_type IN ('PAYMENT_SETTLED', 'WITHHOLDING_TAX_CREDIT') THEN
        SELECT ledger_id INTO v_ledger_id
          FROM ar_ledger
         WHERE payment_id = p_payment_id
           AND payment_source IS NOT DISTINCT FROM p_payment_source
           AND entry_type = p_entry_type;
        IF FOUND THEN
            RETURN v_ledger_id;
        END IF;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_prev_balance
      FROM ar_ledger
     WHERE customer_id = p_customer_id;

    INSERT INTO ar_ledger
        (customer_id, invoice_id, payment_id, cn_id, entry_type,
         amount, balance_after, payment_channel, reference_no, notes, created_by,
         payment_source, entry_date)
    VALUES
        (p_customer_id, p_invoice_id, p_payment_id, p_cn_id, p_entry_type,
         p_amount, v_prev_balance + p_amount, p_payment_channel,
         p_reference_no, p_notes, p_created_by, p_payment_source,
         COALESCE(p_entry_date, CURRENT_TIMESTAMP))
    RETURNING ledger_id INTO v_ledger_id;

    RETURN v_ledger_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.append_ap_ledger_entry(
    p_supplier_id integer,
    p_bill_id integer,
    p_payment_id integer,
    p_entry_type ap_ledger_entry_type,
    p_amount numeric,
    p_payment_channel character varying,
    p_reference_no character varying,
    p_notes text,
    p_created_by integer,
    p_entry_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP
) RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
    v_prev_balance  numeric(12,2);
    v_ledger_id     bigint;
    v_settled_count integer;
    v_reversed_count integer;
BEGIN
    PERFORM pg_advisory_xact_lock(public.master_data_merge_namespace('supplier'), p_supplier_id);
    PERFORM pg_advisory_xact_lock(hashtext('ap_ledger:' || p_supplier_id::text));

    IF p_payment_id IS NOT NULL AND p_entry_type = 'PAYMENT_SETTLED' THEN
        SELECT COUNT(*) FILTER (WHERE entry_type = 'PAYMENT_SETTLED'),
               COUNT(*) FILTER (WHERE entry_type = 'PDC_BOUNCED_REVERSAL')
          INTO v_settled_count, v_reversed_count
          FROM ap_ledger
         WHERE payment_id = p_payment_id;

        IF v_settled_count > v_reversed_count THEN
            SELECT ledger_id INTO v_ledger_id
              FROM ap_ledger
             WHERE payment_id = p_payment_id
               AND entry_type = 'PAYMENT_SETTLED'
             ORDER BY ledger_id DESC
             LIMIT 1;
            RETURN v_ledger_id;
        END IF;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_prev_balance
      FROM ap_ledger
     WHERE supplier_id = p_supplier_id;

    INSERT INTO ap_ledger
        (supplier_id, bill_id, payment_id, entry_type,
         amount, balance_after, payment_channel, reference_no, notes, created_by,
         entry_date)
    VALUES
        (p_supplier_id, p_bill_id, p_payment_id, p_entry_type,
         p_amount, v_prev_balance + p_amount, p_payment_channel,
         p_reference_no, p_notes, p_created_by,
         COALESCE(p_entry_date, CURRENT_TIMESTAMP))
    RETURNING ledger_id INTO v_ledger_id;

    RETURN v_ledger_id;
END;
$function$;

DO $$
DECLARE
    has_ar_drift boolean;
    has_ap_drift boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM (
            SELECT balance_after,
                   SUM(amount) OVER (PARTITION BY customer_id ORDER BY ledger_id ASC)::numeric(12,2) AS expected_balance
            FROM public.ar_ledger
        ) c
        WHERE c.balance_after IS DISTINCT FROM c.expected_balance
    ) INTO has_ar_drift;

    IF has_ar_drift THEN
        ALTER TABLE public.ar_ledger DISABLE TRIGGER trg_ar_ledger_immutable;
        WITH expected AS (
            SELECT ledger_id,
                   SUM(amount) OVER (PARTITION BY customer_id ORDER BY ledger_id ASC)::numeric(12,2) AS expected_balance
            FROM public.ar_ledger
        )
        UPDATE public.ar_ledger l
        SET balance_after = e.expected_balance
        FROM expected e
        WHERE l.ledger_id = e.ledger_id
          AND l.balance_after IS DISTINCT FROM e.expected_balance;
        ALTER TABLE public.ar_ledger ENABLE TRIGGER trg_ar_ledger_immutable;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM (
            SELECT balance_after,
                   SUM(amount) OVER (PARTITION BY supplier_id ORDER BY ledger_id ASC)::numeric(12,2) AS expected_balance
            FROM public.ap_ledger
        ) c
        WHERE c.balance_after IS DISTINCT FROM c.expected_balance
    ) INTO has_ap_drift;

    IF has_ap_drift THEN
        ALTER TABLE public.ap_ledger DISABLE TRIGGER trg_ap_ledger_immutable;
        WITH expected AS (
            SELECT ledger_id,
                   SUM(amount) OVER (PARTITION BY supplier_id ORDER BY ledger_id ASC)::numeric(12,2) AS expected_balance
            FROM public.ap_ledger
        )
        UPDATE public.ap_ledger l
        SET balance_after = e.expected_balance
        FROM expected e
        WHERE l.ledger_id = e.ledger_id
          AND l.balance_after IS DISTINCT FROM e.expected_balance;
        ALTER TABLE public.ap_ledger ENABLE TRIGGER trg_ap_ledger_immutable;
    END IF;
END $$;
