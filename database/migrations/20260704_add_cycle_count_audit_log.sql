-- Audit log table: records every manager approve or recount decision
CREATE TABLE IF NOT EXISTS cycle_count_audit_log (
    log_id              SERIAL PRIMARY KEY,
    line_id             INTEGER REFERENCES cycle_count_line(line_id) ON DELETE SET NULL,
    part_id             INTEGER REFERENCES part(part_id) ON DELETE SET NULL,
    action              VARCHAR(50) NOT NULL,      -- 'APPROVED' | 'RECOUNT_REQUESTED'
    variance_qty        DECIMAL(12, 4),
    financial_impact    DECIMAL(14, 4),
    counted_qty         DECIMAL(12, 4),
    system_qty_snapshot DECIMAL(12, 4),
    actioned_by         INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    actioned_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_cc_audit_log_part     ON cycle_count_audit_log(part_id);
CREATE INDEX IF NOT EXISTS idx_cc_audit_log_actioned ON cycle_count_audit_log(actioned_at DESC);
