-- =============================================================================
-- Migration: 20261019_02_reconcile_bj_auto_and_legacy_hidden_cheques.sql
-- Purpose:   Phase 4 — Idempotent reconciliation of historical hidden cheque
--            and AP payment rows (including BJ AUTO PARTS SUPPLY #313083 -> #313084
--            and MOTO TRUCK #313075 -> #313076) plus visibility restoration for
--            previously soft-deleted cheques #313081 and #313082.
-- =============================================================================

BEGIN;

DO $$
DECLARE
    v_old_cheque_id INTEGER;
    v_new_cheque_id INTEGER;
    v_old_payment_id INTEGER;
    v_new_payment_id INTEGER;
BEGIN
    -- 1. Reconcile BJ AUTO PARTS SUPPLY cheque #313083 -> replaced by #313084
    SELECT c.id, c.ap_payment_id
      INTO v_old_cheque_id, v_old_payment_id
      FROM cheque_records c
     WHERE c.cheque_number = '313083'
       AND c.payee ILIKE '%BJ AUTO%'
     ORDER BY c.id DESC
     LIMIT 1;

    SELECT c.id, c.ap_payment_id
      INTO v_new_cheque_id, v_new_payment_id
      FROM cheque_records c
     WHERE c.cheque_number = '313084'
       AND c.payee ILIKE '%BJ AUTO%'
     ORDER BY c.id DESC
     LIMIT 1;

    IF v_old_cheque_id IS NOT NULL AND v_new_cheque_id IS NOT NULL THEN
        UPDATE cheque_records
           SET status = 'REPLACED',
               is_deleted = FALSE,
               deleted_at = NULL,
               replaced_by_cheque_id = v_new_cheque_id,
               void_reason = COALESCE(void_reason, 'Reconciled replacement by cheque #313084'),
               updated_at = NOW()
         WHERE id = v_old_cheque_id
           AND (status <> 'REPLACED' OR is_deleted = TRUE OR replaced_by_cheque_id IS DISTINCT FROM v_new_cheque_id);

        UPDATE cheque_records
           SET replaces_cheque_id = v_old_cheque_id,
               updated_at = NOW()
         WHERE id = v_new_cheque_id
           AND replaces_cheque_id IS DISTINCT FROM v_old_cheque_id;

        IF v_old_payment_id IS NOT NULL THEN
            UPDATE ap_payment
               SET pdc_status = 'REPLACED',
                   void_reason = COALESCE(void_reason, 'Replaced by cheque #313084')
             WHERE payment_id = v_old_payment_id
               AND pdc_status <> 'REPLACED';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM cheque_clearance_log
             WHERE cheque_record_id = v_old_cheque_id
               AND action = 'REPLACED'
        ) THEN
            INSERT INTO cheque_clearance_log (
                cheque_record_id, ap_payment_id, cheque_type, action,
                notes, metadata
            ) VALUES (
                v_old_cheque_id, v_old_payment_id, 'OUTBOUND_SUPPLIER', 'REPLACED',
                'Historical migration reconciliation: replaced by cheque #313084',
                jsonb_build_object(
                    'replaced_by_cheque_id', v_new_cheque_id,
                    'replaced_by_payment_id', v_new_payment_id,
                    'reconciled_by_migration', '20261019_02_reconcile_bj_auto_and_legacy_hidden_cheques.sql'
                )
            );
        END IF;
    END IF;

    -- 2. Reconcile MOTO TRUCK cheque #313075 -> replaced by #313076 (issued 100s later for identical obligation)
    v_old_cheque_id := NULL;
    v_new_cheque_id := NULL;
    v_old_payment_id := NULL;
    v_new_payment_id := NULL;

    SELECT c.id, c.ap_payment_id
      INTO v_old_cheque_id, v_old_payment_id
      FROM cheque_records c
     WHERE c.cheque_number = '313075'
       AND c.payee ILIKE '%MOTO TRUCK%'
     ORDER BY c.id DESC
     LIMIT 1;

    SELECT c.id, c.ap_payment_id
      INTO v_new_cheque_id, v_new_payment_id
      FROM cheque_records c
     WHERE c.cheque_number = '313076'
       AND c.payee ILIKE '%MOTO TRUCK%'
     ORDER BY c.id DESC
     LIMIT 1;

    IF v_old_cheque_id IS NOT NULL AND v_new_cheque_id IS NOT NULL THEN
        UPDATE cheque_records
           SET status = 'REPLACED',
               is_deleted = FALSE,
               deleted_at = NULL,
               replaced_by_cheque_id = v_new_cheque_id,
               void_reason = COALESCE(void_reason, 'Reconciled replacement by cheque #313076'),
               updated_at = NOW()
         WHERE id = v_old_cheque_id
           AND (status <> 'REPLACED' OR is_deleted = TRUE OR replaced_by_cheque_id IS DISTINCT FROM v_new_cheque_id);

        UPDATE cheque_records
           SET replaces_cheque_id = v_old_cheque_id,
               updated_at = NOW()
         WHERE id = v_new_cheque_id
           AND replaces_cheque_id IS DISTINCT FROM v_old_cheque_id;

        IF v_old_payment_id IS NOT NULL THEN
            UPDATE ap_payment
               SET pdc_status = 'REPLACED',
                   void_reason = COALESCE(void_reason, 'Replaced by cheque #313076')
             WHERE payment_id = v_old_payment_id
               AND pdc_status <> 'REPLACED';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM cheque_clearance_log
             WHERE cheque_record_id = v_old_cheque_id
               AND action = 'REPLACED'
        ) THEN
            INSERT INTO cheque_clearance_log (
                cheque_record_id, ap_payment_id, cheque_type, action,
                notes, metadata
            ) VALUES (
                v_old_cheque_id, v_old_payment_id, 'OUTBOUND_SUPPLIER', 'REPLACED',
                'Historical migration reconciliation: replaced by cheque #313076',
                jsonb_build_object(
                    'replaced_by_cheque_id', v_new_cheque_id,
                    'replaced_by_payment_id', v_new_payment_id,
                    'reconciled_by_migration', '20261019_02_reconcile_bj_auto_and_legacy_hidden_cheques.sql'
                )
            );
        END IF;
    END IF;

    -- 3. Convert remaining legacy hidden (is_deleted=TRUE) cheques (#313081, #313082, or any other unlinked soft-deleted rows)
    --    that have no active replacement into explicit DELETED lifecycle state so no rows remain silently hidden
    --    while preserving non-scheduled status on their linked ap_payment rows.
    FOR v_old_cheque_id, v_old_payment_id IN
        SELECT c.id, c.ap_payment_id
          FROM cheque_records c
         WHERE c.is_deleted = TRUE
           AND c.status NOT IN ('REPLACED', 'DELETED')
    LOOP
        UPDATE cheque_records
           SET status = 'DELETED',
               deleted_reason = COALESCE(deleted_reason, 'Legacy soft-deleted cheque reconciled to explicit DELETED status'),
               updated_at = NOW()
         WHERE id = v_old_cheque_id;

        IF v_old_payment_id IS NOT NULL THEN
            UPDATE ap_payment
               SET pdc_status = 'DELETED',
                   deleted_at = COALESCE(deleted_at, NOW()),
                   deleted_reason = COALESCE(deleted_reason, 'Legacy soft-deleted cheque reconciled to explicit DELETED status')
             WHERE payment_id = v_old_payment_id
               AND pdc_status NOT IN ('DELETED', 'REPLACED', 'VOID');
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM cheque_clearance_log
             WHERE cheque_record_id = v_old_cheque_id
               AND action = 'DELETED'
        ) THEN
            INSERT INTO cheque_clearance_log (
                cheque_record_id, ap_payment_id, cheque_type, action,
                notes, metadata
            ) VALUES (
                v_old_cheque_id, v_old_payment_id, 'OUTBOUND_SUPPLIER', 'DELETED',
                'Legacy soft-deleted cheque reconciled to explicit DELETED status',
                jsonb_build_object(
                    'reconciled_by_migration', '20261019_02_reconcile_bj_auto_and_legacy_hidden_cheques.sql'
                )
            );
        END IF;
    END LOOP;
END $$;

COMMIT;
