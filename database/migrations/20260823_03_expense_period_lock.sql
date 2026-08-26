-- Migration: 20260823_03_expense_period_lock.sql
-- Description: closes the "history can silently change" gap the expense module
--              has had since it was built — any user with expenses:edit can
--              currently alter or void an expense dated into a month that was
--              already reported on, with nothing recording that it happened.
--
-- DESIGN: standard accounting-system behavior, not a permission bypass.
--   A locked period cannot be written to by ANYONE, including an admin, until it
--   is explicitly reopened — an audited action in its own right, distinct from
--   whatever edit motivated it. This mirrors how closed periods work in any real
--   bookkeeping system (QuickBooks, Xero): you reopen, you edit, you close again.
--   It is deliberately NOT a `hasPermission('...:override')` check on the write
--   itself, because that would let a permitted user's edits silently bypass the
--   close with no separate trace that the period was ever touched.
--
-- MODULE-SCOPED FOR REUSE: `module` defaults to 'expenses' (the only caller
-- today) but is not hardcoded into the schema, so AR, AP, or payroll can lock
-- their own periods later against this same table without a new migration —
-- each module's own route layer decides what "locked" means for its writes.

BEGIN;

CREATE TABLE IF NOT EXISTS period_lock (
    lock_id       SERIAL PRIMARY KEY,
    module        VARCHAR(30) NOT NULL DEFAULT 'expenses',
    period_month  DATE NOT NULL, -- always the first day of the month, Manila calendar
    is_locked     BOOLEAN NOT NULL DEFAULT true,
    locked_by     INTEGER REFERENCES employee(employee_id),
    locked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    unlocked_by   INTEGER REFERENCES employee(employee_id),
    unlocked_at   TIMESTAMPTZ,
    unlock_reason TEXT,
    UNIQUE (module, period_month)
);

CREATE INDEX IF NOT EXISTS idx_period_lock_lookup
    ON period_lock (module, period_month, is_locked);

-- Every lock and unlock action, kept even after a period is reopened — the
-- current-state row above answers "is this period locked right now", this table
-- answers "who closed and reopened this period, and why", which is what an
-- auditor actually wants to see.
CREATE TABLE IF NOT EXISTS period_lock_log (
    log_id        BIGSERIAL PRIMARY KEY,
    module        VARCHAR(30) NOT NULL,
    period_month  DATE NOT NULL,
    action        VARCHAR(10) NOT NULL CHECK (action IN ('lock', 'unlock')),
    reason        TEXT,
    employee_id   INTEGER REFERENCES employee(employee_id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_period_lock_log_period
    ON period_lock_log (module, period_month, created_at DESC);

INSERT INTO permission (permission_key, description, category) VALUES
    ('expenses:manage_periods', 'Lock and unlock expense reporting periods', 'Finance')
ON CONFLICT (permission_key) DO NOTHING;

-- Admin only — reopening a closed period is exactly the kind of action that
-- should require the highest permission level, same as void already does not.
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT 10, permission_id FROM permission WHERE permission_key = 'expenses:manage_periods'
ON CONFLICT DO NOTHING;

COMMIT;
