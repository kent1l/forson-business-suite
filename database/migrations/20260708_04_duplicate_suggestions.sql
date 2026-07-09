-- ============================================================
-- Duplicate Suggestions — Pre-computed dedup results table
-- ============================================================

-- Table 1: Tracks each background scan run (for status display in UI)
CREATE TABLE IF NOT EXISTS public.duplicate_suggestion_batch (
    batch_id        SERIAL PRIMARY KEY,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','running','complete','failed')),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    error_message   TEXT,
    total_groups    INT NOT NULL DEFAULT 0,
    ai_calls_made   INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table 2: Each pre-computed duplicate group
CREATE TABLE IF NOT EXISTS public.duplicate_suggestion_group (
    suggestion_id       SERIAL PRIMARY KEY,
    batch_id            INT REFERENCES public.duplicate_suggestion_batch(batch_id) ON DELETE CASCADE,
    group_key           TEXT NOT NULL UNIQUE,   -- SHA256 of sorted part IDs, prevents re-inserting same group
    confidence          TEXT NOT NULL CHECK (confidence IN ('exact','high','medium','low')),
    confidence_score    FLOAT NOT NULL,
    detection_method    TEXT NOT NULL,          -- 'exact_sku' | 'exact_part_number' | 'ai_semantic'
    ai_reason           TEXT,                   -- AI's explanation in plain English
    part_ids            INT[] NOT NULL,         -- Which parts are in this group
    part_data           JSONB NOT NULL,         -- Snapshot of part data at scan time (for fast display)
    status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','dismissed','merged')),
    dismissed_at        TIMESTAMPTZ,
    dismissed_by        INT REFERENCES public.employee(employee_id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for the UI query (load pending suggestions fast)
CREATE INDEX IF NOT EXISTS idx_dsg_status_confidence
    ON public.duplicate_suggestion_group (status, confidence_score DESC);

-- Index for the batch lookup
CREATE INDEX IF NOT EXISTS idx_dsg_batch_id
    ON public.duplicate_suggestion_group (batch_id);

-- Add retry_count to the existing dedupe_scan_queue table (fixes the poison-pill bug)
ALTER TABLE public.dedupe_scan_queue
    ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;

-- Stale row requeue: reset any rows stuck in 'processing' for more than 10 minutes
-- (This is called manually or from the worker on startup)
CREATE OR REPLACE FUNCTION public.reset_stale_dedupe_rows()
RETURNS void LANGUAGE sql AS $$
    UPDATE public.dedupe_scan_queue
    SET status = 'pending'
    WHERE status = 'processing'
      AND updated_at < NOW() - INTERVAL '10 minutes';
$$;
