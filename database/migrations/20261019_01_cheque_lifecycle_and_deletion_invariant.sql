-- Migration: 20261019_01_cheque_lifecycle_and_deletion_invariant.sql
-- Description: Phase 1 — Core state, deletion invariant, chain uniqueness,
--              audit actions, idempotency request log, and deletion permission.

BEGIN;

-- 1. Extend cheque_records with deletion audit metadata
ALTER TABLE cheque_records
  ADD COLUMN IF NOT EXISTS deleted_by integer REFERENCES employee(employee_id),
  ADD COLUMN IF NOT EXISTS deleted_reason text;

-- 2. Extend ap_payment with void/deletion audit metadata
ALTER TABLE ap_payment
  ADD COLUMN IF NOT EXISTS voided_by integer REFERENCES employee(employee_id),
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS deleted_by integer REFERENCES employee(employee_id),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_reason text;

-- 3. Add DELETED to cheque_records.status check constraint
ALTER TABLE cheque_records DROP CONSTRAINT IF EXISTS cheque_records_status_check;
ALTER TABLE cheque_records ADD CONSTRAINT cheque_records_status_check CHECK (
  status IN ('ISSUED', 'HELD_FOR_RELEASE', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'VOID', 'STALE', 'REPLACED', 'DELETED')
);

-- 4. Add VOID and DELETED to ap_payment.pdc_status check constraint
ALTER TABLE ap_payment DROP CONSTRAINT IF EXISTS ap_payment_pdc_status_check;
ALTER TABLE ap_payment ADD CONSTRAINT ap_payment_pdc_status_check CHECK (
  pdc_status IN ('ISSUED', 'HELD_FOR_RELEASE', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'REPLACED', 'VOID', 'DELETED')
);

-- 5. Replace bank/number unique predicate so only DELETED releases numbers
--    (VOID, REPLACED, and legacy is_deleted=true rows keep reserving numbers)
DROP INDEX IF EXISTS uq_cheque_records_bank_number;
CREATE UNIQUE INDEX uq_cheque_records_bank_number
  ON cheque_records (bank_account_id, cheque_number)
  WHERE cheque_number IS NOT NULL AND status <> 'DELETED';

-- 6. Enforce single successor per original instrument, single predecessor per replacement,
--    and single active/cleared cheque per reused expense
ALTER TABLE cheque_records DROP CONSTRAINT IF EXISTS cheque_records_no_self_replace_check;
ALTER TABLE cheque_records ADD CONSTRAINT cheque_records_no_self_replace_check CHECK (
  (replaces_cheque_id IS NULL OR replaces_cheque_id <> id)
  AND (replaced_by_cheque_id IS NULL OR replaced_by_cheque_id <> id)
  AND (replaces_cheque_id IS NULL OR replaced_by_cheque_id IS NULL OR replaces_cheque_id <> replaced_by_cheque_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cheque_records_replaces_cheque
  ON cheque_records (replaces_cheque_id)
  WHERE replaces_cheque_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cheque_records_replaced_by_cheque
  ON cheque_records (replaced_by_cheque_id)
  WHERE replaced_by_cheque_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cheque_records_active_expense
  ON cheque_records (expense_id)
  WHERE expense_id IS NOT NULL AND status NOT IN ('VOID', 'REPLACED', 'DELETED');

-- 7. Extend cheque_clearance_log for non-AP instruments, deletion snapshots, and PDF events
ALTER TABLE cheque_clearance_log
  ADD COLUMN IF NOT EXISTS expense_id bigint REFERENCES expense(expense_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

ALTER TABLE cheque_clearance_log DROP CONSTRAINT IF EXISTS cheque_clearance_log_cheque_type_check;
ALTER TABLE cheque_clearance_log ADD CONSTRAINT cheque_clearance_log_cheque_type_check CHECK (
  cheque_type IN ('INBOUND_CUSTOMER', 'OUTBOUND_SUPPLIER', 'OUTBOUND_EXPENSE', 'OUTBOUND_STANDALONE')
);

ALTER TABLE cheque_clearance_log DROP CONSTRAINT IF EXISTS cheque_clearance_log_action_check;
ALTER TABLE cheque_clearance_log ADD CONSTRAINT cheque_clearance_log_action_check CHECK (
  action IN (
    'RECEIVED', 'DEPOSITED', 'BOUNCED', 'REDEPOSITED', 'CLEARED',
    'VOID', 'REPLACED', 'DELETED', 'RESTORED',
    'PRINTED', 'PDF_GENERATED', 'TEST_PDF_GENERATED'
  )
);

-- 8. Allow ap_ledger PAYMENT_SETTLED to be posted again if a prior PAYMENT_SETTLED was reversed by PDC_BOUNCED_REVERSAL
DROP INDEX IF EXISTS uq_ap_ledger_payment_settled;

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
)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_prev_balance  numeric(12,2);
    v_ledger_id     bigint;
    v_settled_count integer;
    v_reversed_count integer;
BEGIN
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

    SELECT balance_after INTO v_prev_balance
      FROM ap_ledger
     WHERE supplier_id = p_supplier_id
     ORDER BY ledger_id DESC
     LIMIT 1
       FOR UPDATE;

    v_prev_balance := COALESCE(v_prev_balance, 0);

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

-- 9. Request idempotency table for cheque/payment lifecycle mutations
CREATE TABLE IF NOT EXISTS cheque_lifecycle_request (
  request_id uuid PRIMARY KEY,
  actor_id integer NOT NULL REFERENCES employee(employee_id),
  action varchar(50) NOT NULL,
  target_type varchar(50) NOT NULL,
  target_id bigint NOT NULL,
  payload_hash varchar(64) NOT NULL,
  status_code integer NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cheque_lifecycle_request_target
  ON cheque_lifecycle_request (target_type, target_id);

-- 10. Seed narrowly scoped deletion permission for outbound cheques/payments
INSERT INTO permission (permission_key, description, category)
VALUES (
  'ap-pdc:delete',
  'Delete erroneous unsettled outbound cheques and payments to release cheque numbers',
  'Finance & Treasury'
)
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl
CROSS JOIN permission p
WHERE pl.level_name IN ('Admin', 'Manager', 'Secretary', 'Super Admin')
  AND p.permission_key = 'ap-pdc:delete'
ON CONFLICT DO NOTHING;

COMMIT;
