-- Durable Jev duplicate-decision cache.
--
-- This is intentionally separate from *_duplicate_suggestion. Suggestions
-- represent a human-review workflow and can be dismissed or merged; this table
-- stores reusable model probabilities, including negative decisions. A cache
-- entry is used only when both normalized inputs, the configured model, and
-- the versioned duplicate prompt still match.

CREATE TABLE IF NOT EXISTS public.entity_duplicate_decision_cache (
    entity_type TEXT NOT NULL CHECK (entity_type IN ('brand', 'group')),
    left_entity_id INTEGER NOT NULL,
    right_entity_id INTEGER NOT NULL,
    left_input_fingerprint CHAR(64) NOT NULL,
    right_input_fingerprint CHAR(64) NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    probability NUMERIC(5,4) NOT NULL CHECK (probability BETWEEN 0 AND 1),
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (entity_type, left_entity_id, right_entity_id),
    CONSTRAINT chk_entity_duplicate_decision_cache_pair_order
        CHECK (left_entity_id < right_entity_id)
);

