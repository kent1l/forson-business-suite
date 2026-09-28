-- Cache immutable Jev batch inputs so daily schedules only call the provider
-- when a candidate's underlying facts, prompt, model, or TTL require a refresh.
ALTER TABLE public.jev_inventory_score
    ADD COLUMN IF NOT EXISTS input_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS idx_jev_inventory_score_fingerprint
    ON public.jev_inventory_score (score_type, input_fingerprint, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS public.jev_dedupe_cluster_cache (
    cluster_fingerprint TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    probability NUMERIC(5,4) NOT NULL CHECK (probability BETWEEN 0 AND 1),
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (cluster_fingerprint, model, prompt_version)
);

CREATE INDEX IF NOT EXISTS idx_jev_dedupe_cluster_cache_fresh
    ON public.jev_dedupe_cluster_cache (evaluated_at DESC);
