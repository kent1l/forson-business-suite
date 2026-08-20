-- Migration: in-app notification centre (bell + badge in the top bar).
-- Date: 2026-08-20 (Asia/Manila)
--
-- Design notes
-- ------------
-- Fan-out is *lazy*, not materialised. A business alert ("3 bills are overdue")
-- is stored once, tagged with the permission key that gates it, and resolved to
-- an audience at read time by joining against the caller's role permissions.
-- Materialising one row per eligible employee at emit time was rejected because
-- role changes are common here (permission_level_id is re-read on every request
-- by authMiddleware, precisely so a demotion takes effect immediately) — a
-- pre-baked recipient list would keep showing finance alerts to someone who was
-- moved off finance yesterday, and would hide them from someone moved on today.
--
-- Read state therefore cannot live on the notification row. It lives in
-- notification_receipt, written only when a user actually reads or dismisses
-- something, plus a per-employee `all_read_before` watermark so "mark all as
-- read" stays a single UPDATE instead of an insert per visible notification.
--
-- Deduplication is the emitter's job via dedupe_key: the daily reminder scans
-- re-run every morning over the same open bills, so each alert carries a key
-- like 'ap.bill_overdue:412:2026-08-20' and inserts ON CONFLICT DO NOTHING.

BEGIN;

CREATE TABLE IF NOT EXISTS notification (
    notification_id     BIGSERIAL PRIMARY KEY,

    -- Machine-readable event type, e.g. 'ap.bill_due_today', 'leave.approved'.
    -- The frontend maps this to an icon; never parse the title for meaning.
    type                VARCHAR(60)  NOT NULL,
    -- Coarse grouping for the panel's filter tabs.
    category            VARCHAR(30)  NOT NULL
        CHECK (category IN ('finance', 'treasury', 'hr', 'inventory', 'system')),
    severity            VARCHAR(10)  NOT NULL DEFAULT 'info'
        CHECK (severity IN ('info', 'warning', 'critical')),

    title               VARCHAR(200) NOT NULL,
    body                TEXT,

    -- Where clicking the notification takes the user. link_page is a key from
    -- MainLayout's page switch (e.g. 'ap', 'leave'); link_state is handed to
    -- onNavigate as the page's initial state.
    link_page           VARCHAR(60),
    link_state          JSONB,

    -- What the notification is about, for future "open this exact record" work
    -- and for operators tracing an alert back to its source row.
    entity_type         VARCHAR(40),
    entity_id           VARCHAR(60),

    -- Audience. At least one of these must be set, enforced below.
    --   required_permission -> everyone holding that permission key (plus admins)
    --   target_employee_id  -> exactly that employee ("your leave was approved")
    required_permission VARCHAR(60),
    target_employee_id  INTEGER REFERENCES employee(employee_id) ON DELETE CASCADE,

    -- Idempotency for repeated scans. NULL means "always insert" (genuine
    -- one-off events); UNIQUE tolerates many NULLs in Postgres, which is what
    -- we want here.
    dedupe_key          VARCHAR(200) UNIQUE,

    -- Who caused the event, when it happened, and when it stops being useful.
    actor_employee_id   INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ,

    CONSTRAINT notification_has_audience
        CHECK (required_permission IS NOT NULL OR target_employee_id IS NOT NULL)
);

-- The panel's only real access pattern: newest-first over a small window.
CREATE INDEX IF NOT EXISTS idx_notification_created_at
    ON notification (created_at DESC);

-- Permission fan-out lookups, and the direct-to-employee lookups, respectively.
CREATE INDEX IF NOT EXISTS idx_notification_required_permission
    ON notification (required_permission)
    WHERE required_permission IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_target_employee
    ON notification (target_employee_id, created_at DESC)
    WHERE target_employee_id IS NOT NULL;

-- Lets the groomer prune by age cheaply.
CREATE INDEX IF NOT EXISTS idx_notification_expires_at
    ON notification (expires_at)
    WHERE expires_at IS NOT NULL;


-- Per-(notification, employee) read/dismiss state. A missing row means unread
-- and undismissed, so this table only grows with actual user interaction rather
-- than with the cross product of notifications and staff.
CREATE TABLE IF NOT EXISTS notification_receipt (
    notification_id BIGINT  NOT NULL REFERENCES notification(notification_id) ON DELETE CASCADE,
    employee_id     INTEGER NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
    read_at         TIMESTAMPTZ,
    dismissed_at    TIMESTAMPTZ,
    PRIMARY KEY (notification_id, employee_id)
);

-- "Which of these notifications have I already seen?" — the panel's join.
CREATE INDEX IF NOT EXISTS idx_notification_receipt_employee
    ON notification_receipt (employee_id, notification_id);


-- One row per employee holding the "mark all as read" watermark. Anything
-- created at or before all_read_before counts as read for that employee without
-- a receipt row existing, which keeps mark-all-read O(1) no matter how many
-- notifications are visible.
CREATE TABLE IF NOT EXISTS employee_notification_state (
    employee_id     INTEGER PRIMARY KEY REFERENCES employee(employee_id) ON DELETE CASCADE,
    all_read_before TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- Retention. Notifications are transient by nature and the emitters re-raise
-- anything still true on the next daily scan, so keeping them forever only
-- grows the table. Called from the notification service's daily groomer.
CREATE OR REPLACE FUNCTION prune_notifications(p_keep_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM notification
    WHERE created_at < NOW() - (p_keep_days || ' days')::INTERVAL
       OR (expires_at IS NOT NULL AND expires_at < NOW());
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;


-- Cron schedules for the two new/updated scans, editable from Settings the same
-- way PDC_REMINDER_SCHEDULE already is.
INSERT INTO settings (setting_key, setting_value, description)
VALUES
    ('AR_DUE_DATE_REMINDER_SCHEDULE', '0 7 * * *',
     'Cron schedule for the daily A/R overdue-invoice notification scan (Asia/Manila).'),
    ('NOTIFICATION_RETENTION_DAYS', '90',
     'How many days in-app notifications are kept before the daily groomer deletes them.')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
