-- Migration: 20261020_03_grn_import_review_and_line_identity.sql
-- Description: External Supplier Document JSON Ingestion Phase A:
--              1. Add stable line_uuid to goods_receipt_line with unique index.
--              2. Create grn_import_review table for durable review, lifecycle, and provenance.

-- 1. Add stable line_uuid to goods_receipt_line
ALTER TABLE goods_receipt_line
  ADD COLUMN IF NOT EXISTS line_uuid uuid DEFAULT gen_random_uuid();

UPDATE goods_receipt_line
  SET line_uuid = gen_random_uuid()
  WHERE line_uuid IS NULL;

ALTER TABLE goods_receipt_line
  ALTER COLUMN line_uuid SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_goods_receipt_line_line_uuid
  ON goods_receipt_line (line_uuid);

-- 2. Create grn_import_review table
CREATE TABLE IF NOT EXISTS grn_import_review (
  import_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_employee_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('IN_REVIEW', 'COMMITTED', 'ABANDONED')),
  schema_version smallint NOT NULL CHECK (schema_version = 1),
  source_payload jsonb,
  payload_hash text NOT NULL,
  initial_context jsonb NOT NULL,
  review_state jsonb,
  commit_snapshot jsonb,
  lifecycle_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  grn_id integer NULL REFERENCES goods_receipt(grn_id) ON DELETE RESTRICT,
  request_key uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  commit_review_version integer NULL,
  document_id integer NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  committed_at timestamptz NULL,
  abandoned_at timestamptz NULL,
  purged_at timestamptz NULL,

  CONSTRAINT uq_grn_import_review_creator_request UNIQUE (created_by_employee_id, request_key),
  CONSTRAINT chk_grn_import_review_initial_context CHECK (jsonb_typeof(initial_context) = 'object'),
  CONSTRAINT chk_grn_import_review_lifecycle CHECK (jsonb_typeof(lifecycle_events) = 'array'),
  CONSTRAINT chk_grn_import_review_source_payload CHECK (source_payload IS NULL OR jsonb_typeof(source_payload) = 'object'),
  CONSTRAINT chk_grn_import_review_review_state CHECK (review_state IS NULL OR jsonb_typeof(review_state) = 'object'),
  CONSTRAINT chk_grn_import_review_commit_snapshot CHECK (commit_snapshot IS NULL OR jsonb_typeof(commit_snapshot) = 'object'),

  CONSTRAINT chk_grn_import_review_committed_state CHECK (
    (status <> 'COMMITTED') OR (
      grn_id IS NOT NULL AND
      commit_snapshot IS NOT NULL AND
      committed_at IS NOT NULL AND
      commit_review_version IS NOT NULL AND
      abandoned_at IS NULL AND
      purged_at IS NULL
    )
  ),

  CONSTRAINT chk_grn_import_review_abandoned_state CHECK (
    (status <> 'ABANDONED') OR (
      abandoned_at IS NOT NULL AND
      grn_id IS NULL AND
      commit_snapshot IS NULL AND
      committed_at IS NULL AND
      commit_review_version IS NULL
    )
  ),

  CONSTRAINT chk_grn_import_review_in_review_state CHECK (
    (status <> 'IN_REVIEW') OR (
      grn_id IS NULL AND
      commit_snapshot IS NULL AND
      committed_at IS NULL AND
      commit_review_version IS NULL AND
      abandoned_at IS NULL AND
      purged_at IS NULL
    )
  ),

  CONSTRAINT chk_grn_import_review_purged_state CHECK (
    (purged_at IS NULL AND source_payload IS NOT NULL AND review_state IS NOT NULL) OR
    (purged_at IS NOT NULL AND status = 'ABANDONED' AND source_payload IS NULL AND review_state IS NULL AND document_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_grn_import_review_grn_id
  ON grn_import_review (grn_id)
  WHERE grn_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grn_import_review_lookup
  ON grn_import_review (created_by_employee_id, status, updated_at DESC, import_id DESC);
