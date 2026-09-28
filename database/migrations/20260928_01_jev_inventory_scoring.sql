-- Jev is an advisory batch overlay.  Keep its compact, expiring decisions out
-- of transactional inventory tables so local formulas remain the safe fallback.
CREATE TABLE IF NOT EXISTS public.jev_inventory_score (
    part_id BIGINT NOT NULL REFERENCES public.part(part_id) ON DELETE CASCADE,
    score_type TEXT NOT NULL CHECK (score_type IN ('cycle_count', 'reorder')),
    score SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 2),
    confidence NUMERIC(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    model TEXT NOT NULL,
    local_score NUMERIC NULL,
    factors JSONB NOT NULL DEFAULT '{}'::jsonb,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (part_id, score_type)
);

CREATE INDEX IF NOT EXISTS idx_jev_inventory_score_fresh
    ON public.jev_inventory_score (score_type, evaluated_at DESC);
