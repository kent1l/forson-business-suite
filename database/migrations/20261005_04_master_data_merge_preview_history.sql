-- Record blocked operator previews without creating a merge operation.
CREATE TABLE IF NOT EXISTS public.master_data_merge_blocked_preview (
    preview_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type text NOT NULL CHECK (entity_type IN ('supplier', 'customer', 'brand', 'group')),
    canonical_id integer NOT NULL,
    source_ids integer[] NOT NULL,
    actor_employee_id integer NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
    observed_at timestamptz NOT NULL DEFAULT now(),
    impact jsonb NOT NULL,
    blockers jsonb NOT NULL,
    master_names jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_master_data_merge_blocked_preview_history
    ON public.master_data_merge_blocked_preview (entity_type, observed_at DESC);
