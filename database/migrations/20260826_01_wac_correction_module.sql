-- Migration: 20260826_01_wac_correction_module.sql
-- Description: Cost/WAC correction workflow.
--
--   Weighted average cost is derived entirely from the StockIn history in
--   inventory_transaction — part.wac_cost is never directly settable, and any value
--   written to it by hand is silently overwritten the next time
--   recompute_wac_for_part() runs. So a part whose receipts were never entered (or
--   were entered at the wrong date) cannot be corrected by editing a cost field; the
--   missing receipts have to be reconstructed as real ledger rows.
--
--   These tables hold that reconstruction while it is still a *proposal*. An encoder
--   researches a part and records the dated receipts they can document; nothing
--   touches inventory_transaction until a manager approves. That split matters
--   because an approved correction is load-bearing: every sale after it takes its
--   cost from the resulting WAC, so an unreviewed typo would quietly corrupt margin
--   reporting from that date forward.
--
--   Quantity correction is deliberately NOT part of this workflow — cycle count owns
--   that. The WAC formula sums all transaction types for prev_stock, so cost
--   correction only produces a trustworthy average once quantity is already correct;
--   wac_correction_line.cycle_count_line_id records which validated count a
--   correction was built on.

BEGIN;

-- ────────────────────────────────────────────
-- 1. Assignment: which parts are queued for cost research, and for whom.
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wac_correction_batch (
    batch_id        SERIAL PRIMARY KEY,
    employee_id     INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    -- Cost research follows paperwork, and paperwork is filed by supplier. Batching by
    -- supplier lets one encoder work one invoice binder instead of chasing five.
    supplier_id     INTEGER REFERENCES supplier(supplier_id) ON DELETE SET NULL,
    status          VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by      INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    completed_at    TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS wac_correction_line (
    line_id             SERIAL PRIMARY KEY,
    batch_id            INTEGER REFERENCES wac_correction_batch(batch_id) ON DELETE CASCADE,
    part_id             INTEGER NOT NULL REFERENCES part(part_id) ON DELETE CASCADE,
    -- PENDING → PROPOSED → PENDING_MANAGER_REVIEW → APPROVED | REJECTED
    status              VARCHAR(50) NOT NULL DEFAULT 'PENDING',

    -- Snapshot of why this part was queued, so the review desk can rank and explain
    -- the work without recomputing the audit report.
    system_qty_snapshot DECIMAL(12, 4),
    wac_before          DECIMAL(12, 4),
    impact_estimate     DECIMAL(14, 4),

    -- The validated cycle count this correction is built on. Null until the quantity
    -- gate is satisfied; a line must not be approved without it.
    cycle_count_line_id INTEGER REFERENCES cycle_count_line(line_id) ON DELETE SET NULL,
    counted_qty         DECIMAL(12, 4),

    -- Filled in on approval, so the audit trail keeps the arithmetic that ran.
    gap_qty             DECIMAL(12, 4),
    gap_unit_cost       DECIMAL(12, 4),
    wac_after           DECIMAL(12, 4),

    proposed_by         INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    proposed_at         TIMESTAMP WITH TIME ZONE,
    reviewed_by         INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    reviewed_at         TIMESTAMP WITH TIME ZONE,
    review_notes        TEXT,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- One open correction per part at a time. Two encoders reconstructing the same part
-- in parallel would post both sets of receipts and double the stock.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wac_correction_open_part
    ON wac_correction_line(part_id)
    WHERE status IN ('PENDING', 'PROPOSED', 'PENDING_MANAGER_REVIEW');

CREATE INDEX IF NOT EXISTS idx_wac_corr_line_status ON wac_correction_line(status);
CREATE INDEX IF NOT EXISTS idx_wac_corr_line_batch  ON wac_correction_line(batch_id);
CREATE INDEX IF NOT EXISTS idx_wac_corr_line_impact ON wac_correction_line(impact_estimate DESC);

-- ────────────────────────────────────────────
-- 2. The proposed receipts themselves — one row per documented delivery.
--    Multiple dated entries per part are the point: replaying three real receipts
--    chronologically yields a true historical average, where one lump-sum guess
--    yields an approximation.
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wac_correction_entry (
    entry_id            SERIAL PRIMARY KEY,
    line_id             INTEGER NOT NULL REFERENCES wac_correction_line(line_id) ON DELETE CASCADE,
    date_received       TIMESTAMP WITH TIME ZONE NOT NULL,
    quantity            DECIMAL(12, 4) NOT NULL CHECK (quantity > 0),
    unit_cost           DECIMAL(12, 4) NOT NULL CHECK (unit_cost > 0),
    -- Invoice / DR / price-list reference. This is the evidence a manager reviews;
    -- an entry with no source is an estimate and must be declared as one.
    source_reference    VARCHAR(255),
    is_estimate         BOOLEAN NOT NULL DEFAULT FALSE,
    notes               TEXT,
    -- Set once posted, linking the proposal to the ledger row it became.
    inv_trans_id        INTEGER REFERENCES inventory_transaction(inv_trans_id) ON DELETE SET NULL,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wac_corr_entry_line ON wac_correction_entry(line_id);

-- ────────────────────────────────────────────
-- 3. Audit trail, mirroring cycle_count_audit_log.
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wac_correction_audit_log (
    log_id          SERIAL PRIMARY KEY,
    line_id         INTEGER REFERENCES wac_correction_line(line_id) ON DELETE SET NULL,
    part_id         INTEGER REFERENCES part(part_id) ON DELETE SET NULL,
    action          VARCHAR(50) NOT NULL,   -- 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'REOPENED'
    wac_before      DECIMAL(12, 4),
    wac_after       DECIMAL(12, 4),
    entry_count     INTEGER,
    gap_qty         DECIMAL(12, 4),
    actioned_by     INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    actioned_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_wac_corr_audit_part     ON wac_correction_audit_log(part_id);
CREATE INDEX IF NOT EXISTS idx_wac_corr_audit_actioned ON wac_correction_audit_log(actioned_at DESC);

-- ────────────────────────────────────────────
-- 4. Permissions. Propose and approve are separate on purpose: the encoder who
--    researches a cost must not be the one who commits it to the ledger.
-- ────────────────────────────────────────────
INSERT INTO permission (permission_key, description, category) VALUES
    ('wac_correction:propose', 'Research and propose inventory cost corrections', 'Inventory'),
    ('wac_correction:approve', 'Review and post proposed inventory cost corrections', 'Inventory')
ON CONFLICT (permission_key) DO NOTHING;

-- Secretary (5) and Inventory Clerk (1) research; Manager (7) and Admin (10) post.
-- Admin keeps both so the workflow is usable before roles are reassigned.
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT lvl, p.permission_id
FROM permission p
CROSS JOIN (VALUES (1), (5), (10)) AS t(lvl)
WHERE p.permission_key = 'wac_correction:propose'
ON CONFLICT (permission_level_id, permission_id) DO NOTHING;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT lvl, p.permission_id
FROM permission p
CROSS JOIN (VALUES (7), (10)) AS t(lvl)
WHERE p.permission_key = 'wac_correction:approve'
ON CONFLICT (permission_level_id, permission_id) DO NOTHING;

COMMIT;
