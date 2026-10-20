-- Migration: 20261020_01_supplier_bill_references_and_identities.sql
-- Description: Supplier A/P shared workflows Phase 1 schema changes:
--              1. Add supplier document references and liability basis to supplier_bill.
--              2. Create supplier_bill_correction_log for audited amount and reference updates.
--              3. Create supplier_bill_document_identity for verified typed primary references and aliases.
--              4. Add conservative supplier_bill_match_key function.
--              5. Realign goods_receipt physical receipt unique index to exclude Cancelled drafts.
--              6. Drop per-GR supplier invoice unique index (invoice refs repeatable across receipts).
--              7. Create ap_operation_idempotency for receiving and payment mutation idempotency.
--              8. Backfill existing bills and identities.

-- 1. Extend supplier_bill with document references and liability basis
ALTER TABLE supplier_bill
  ADD COLUMN IF NOT EXISTS supplier_document_type varchar(50) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS supplier_document_no varchar(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS liability_basis varchar(50) NOT NULL DEFAULT 'legacy_unknown';

ALTER TABLE supplier_bill
  DROP CONSTRAINT IF EXISTS chk_supplier_bill_liability_basis;

ALTER TABLE supplier_bill
  ADD CONSTRAINT chk_supplier_bill_liability_basis
  CHECK (liability_basis IN ('independent', 'receipt_derived', 'freight', 'legacy_unknown'));

-- 2. Normalization helper for conservative supplier document matching
CREATE OR REPLACE FUNCTION supplier_bill_match_key(val text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN val IS NULL THEN NULL
    WHEN length(trim(both from val)) = 0 THEN NULL
    ELSE lower(trim(both from val))
  END;
$$;

-- 3. Bill document identity table for verified typed primary references and aliases
CREATE TABLE IF NOT EXISTS supplier_bill_document_identity (
  identity_id serial PRIMARY KEY,
  bill_id integer NOT NULL REFERENCES supplier_bill(bill_id) ON DELETE CASCADE,
  supplier_id integer NOT NULL REFERENCES supplier(supplier_id) ON DELETE CASCADE,
  document_type varchar(50) NOT NULL,
  document_no varchar(255) NOT NULL,
  normalized_key varchar(255) NOT NULL,
  is_primary boolean NOT NULL DEFAULT true,
  status varchar(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'superseded')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sb_doc_identity_bill
  ON supplier_bill_document_identity (bill_id);

CREATE INDEX IF NOT EXISTS idx_sb_doc_identity_supplier
  ON supplier_bill_document_identity (supplier_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_bill_active_identity
  ON supplier_bill_document_identity (supplier_id, document_type, normalized_key)
  WHERE (status = 'active');

-- Master data merge guard for supplier_id on supplier_bill_document_identity
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_table = 'supplier_bill_document_identity'
      AND trigger_name = 'master_merge_guard_supplier_id'
  ) THEN
    CREATE TRIGGER master_merge_guard_supplier_id
    BEFORE INSERT OR UPDATE OR DELETE ON supplier_bill_document_identity
    FOR EACH ROW EXECUTE FUNCTION guard_master_data_reference('supplier', 'supplier_id');
  END IF;
END $$;

-- 4. Supplier bill correction log
CREATE TABLE IF NOT EXISTS supplier_bill_correction_log (
  correction_id serial PRIMARY KEY,
  bill_id integer NOT NULL REFERENCES supplier_bill(bill_id) ON DELETE CASCADE,
  actor_id integer REFERENCES employee(employee_id),
  correction_type varchar(50) NOT NULL,
  old_total_amount numeric(12, 2),
  new_total_amount numeric(12, 2),
  old_document_type varchar(50),
  new_document_type varchar(50),
  old_document_no varchar(255),
  new_document_no varchar(255),
  old_basis varchar(50),
  new_basis varchar(50),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sb_correction_log_bill
  ON supplier_bill_correction_log (bill_id);

-- 5. Unified AP operation idempotency log
CREATE TABLE IF NOT EXISTS ap_operation_idempotency (
  request_id varchar(128) PRIMARY KEY,
  actor_id integer NOT NULL REFERENCES employee(employee_id),
  operation varchar(50) NOT NULL,
  payload_hash varchar(64) NOT NULL,
  status_code integer NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ap_operation_idempotency_op
  ON ap_operation_idempotency (operation, actor_id);

-- 6. Adjust goods_receipt physical receipt unique indexes to exclude Cancelled drafts
DROP INDEX IF EXISTS uq_goods_receipt_supplier_physical_receipt;
CREATE UNIQUE INDEX uq_goods_receipt_supplier_physical_receipt
  ON goods_receipt (supplier_id, physical_receipt_no)
  WHERE (physical_receipt_no IS NOT NULL AND length(trim(both from physical_receipt_no)) > 0 AND status <> 'Voided' AND workflow_status <> 'Cancelled');

DROP INDEX IF EXISTS uq_goods_receipt_supplier_physical_receipt_normalized;
CREATE UNIQUE INDEX uq_goods_receipt_supplier_physical_receipt_normalized
  ON goods_receipt (supplier_id, goods_receipt_match_key(physical_receipt_no))
  WHERE (physical_receipt_no IS NOT NULL AND length(trim(both from physical_receipt_no)) > 0 AND status <> 'Voided' AND workflow_status <> 'Cancelled');

-- 7. Drop per-GR supplier invoice unique index (invoice references repeatable across receipts)
DROP INDEX IF EXISTS uq_goods_receipt_supplier_invoice;

-- 8. Backfill historical supplier_bill liability basis and initial identities
-- Auto goods bills
UPDATE supplier_bill
SET liability_basis = 'receipt_derived'
WHERE grn_id IS NOT NULL AND liability_basis = 'legacy_unknown';

-- Freight bills
UPDATE supplier_bill
SET liability_basis = 'freight'
WHERE grn_id IS NULL AND bill_id IN (SELECT bill_id FROM goods_receipt_freight WHERE bill_id IS NOT NULL)
  AND liability_basis = 'legacy_unknown';

-- Independent manual bills
UPDATE supplier_bill
SET liability_basis = 'independent'
WHERE grn_id IS NULL AND bill_id NOT IN (SELECT bill_id FROM goods_receipt_freight WHERE bill_id IS NOT NULL)
  AND liability_basis = 'legacy_unknown';

-- Populate supplier_document_no from bill_number for manual bills that used supplier invoice numbers
UPDATE supplier_bill
SET supplier_document_type = 'invoice',
    supplier_document_no = bill_number
WHERE liability_basis = 'independent'
  AND bill_number NOT LIKE 'BILL-%'
  AND supplier_document_no IS NULL;

-- Register initial identities for manual bills
INSERT INTO supplier_bill_document_identity (bill_id, supplier_id, document_type, document_no, normalized_key, is_primary, status)
SELECT
  sb.bill_id,
  sb.supplier_id,
  sb.supplier_document_type,
  sb.supplier_document_no,
  supplier_bill_match_key(sb.supplier_document_no),
  true,
  'active'
FROM supplier_bill sb
WHERE sb.supplier_document_no IS NOT NULL
  AND sb.status <> 'Void'
ON CONFLICT (supplier_id, document_type, normalized_key) WHERE (status = 'active') DO NOTHING;
