-- ---------------------------------------------------------------------------
-- Mobile self-service: offline-safe punches and own-record read permissions
-- ---------------------------------------------------------------------------
-- The mobile app queues writes while the shop LAN is unreachable and flushes
-- them later. Two things stood in the way of doing that correctly for time
-- punches.
--
-- First, dedupe. `uq_time_punch_dedupe` keys on (employee_id, punch_at,
-- direction), which only dedupes a retry if the retry carries a byte-identical
-- timestamp. A client generated id is a stronger key: the flush can retry
-- forever and still land exactly one row.
--
-- Second, visibility. Every existing DTR and leave read is gated on `dtr:view`
-- / `leave:view`, which mean "see the whole company's attendance". Granting
-- those to rank and file so they can look at their own timesheet would leak
-- everyone else's. These new `*:view_own` keys are the narrow version.

BEGIN;

-- ---------------------------------------------------------------------------
-- (a) Client-generated punch id, so an offline flush retry is a true no-op
-- ---------------------------------------------------------------------------
ALTER TABLE public.time_punch
    ADD COLUMN IF NOT EXISTS client_punch_id UUID;

-- Partial, so the column stays optional for device imports and web punches
-- which have no client to generate one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_punch_client_id
    ON public.time_punch (client_punch_id) WHERE client_punch_id IS NOT NULL;

-- A punch captured offline is still a real punch, but a supervisor reviewing a
-- disputed day needs to know it was recorded from a phone's clock rather than
-- the server's.
-- The original CHECK on `source` was created inline and so carries a
-- generated name. Find it by definition, drop it, and re-add a named one that
-- also admits 'Mobile-Offline'.
DO $$
DECLARE
    con_name TEXT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.time_punch'::regclass AND conname = 'time_punch_source_chk'
    ) THEN
        RETURN;
    END IF;

    SELECT conname INTO con_name
    FROM pg_constraint
    WHERE conrelid = 'public.time_punch'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%source%'
    LIMIT 1;

    IF con_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.time_punch DROP CONSTRAINT %I', con_name);
    END IF;

    ALTER TABLE public.time_punch ADD CONSTRAINT time_punch_source_chk
        CHECK (source IN ('Device', 'Web', 'Mobile', 'Mobile-Offline', 'Import', 'Manual'));
END$$;

-- ---------------------------------------------------------------------------
-- (b) How far back a client is allowed to backdate a punch
-- ---------------------------------------------------------------------------
-- Anything older than this is still stored -- losing a real clock-in is worse
-- than accepting a late one -- but it is marked for HR review instead of being
-- taken at face value.
INSERT INTO settings (setting_key, setting_value, description) VALUES
    ('DTR_PUNCH_MAX_BACKDATE_MINUTES', '720',
     'How many minutes into the past a mobile client may backdate an offline-captured punch before it is flagged for HR review')
ON CONFLICT (setting_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- (c) Own-record permissions, granted to every role
-- ---------------------------------------------------------------------------
INSERT INTO permission (permission_key, description, category) VALUES
    ('dtr:view_own',   'View your own timesheet and punches', 'Human Resources'),
    ('leave:view_own', 'View your own leave balances and requests', 'Human Resources')
ON CONFLICT (permission_key) DO NOTHING;

-- Everyone may look at their own record, exactly as everyone may already punch
-- (dtr:punch) and read their own payslip (payslip:view_own).
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl CROSS JOIN permission p
WHERE p.permission_key IN ('dtr:view_own', 'leave:view_own')
ON CONFLICT DO NOTHING;

-- Filing leave was seeded only to Admin / Manager / Super Admin / Secretary, so
-- warehouse and counter staff could not request leave at all. Ownership is now
-- enforced server-side in leaveRoutes.js, so granting this broadly no longer
-- lets a requester file on someone else's behalf.
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl CROSS JOIN permission p
WHERE p.permission_key = 'leave:request'
ON CONFLICT DO NOTHING;

COMMIT;
