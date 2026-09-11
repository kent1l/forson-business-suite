-- Migration: Decouple engine into global master data (Vehicle Fitment Phase 0)
-- Real-world engine codes (e.g. "4D56", "6M40", "10PE") are shared across many
-- makes/models/years, but the previous schema scoped vehicle_engine to a single
-- model, forcing the same physical engine to be recreated per model and making
-- "fits any vehicle with this engine" fitment impractical to enter.
--
-- This migration:
--   1. Introduces a global `engine` master table.
--   2. Repurposes the old model-scoped vehicle_engine rows into
--      `vehicle_engine_fitment` (which models used which engines, and when).
--   3. Relaxes `application` so make_id/model_id/engine_id can each be set
--      independently (enabling engine-only, make-only, etc. fitment), replacing
--      the old UNIQUE(make_id, model_id, engine_id) constraint -- which treats
--      NULLs as distinct and so failed to prevent duplicate engine-only rows --
--      with partial unique indexes per specificity tier.
--   4. Adds part.is_universal for generic parts that skip fitment entirely.
-- 2026-09-09

BEGIN;

-- 1. Global engine master table.
CREATE TABLE IF NOT EXISTS public.engine (
    engine_id serial PRIMARY KEY,
    engine_code character varying(100) NOT NULL,
    notes text
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'engine_engine_code_key'
    ) THEN
        ALTER TABLE public.engine ADD CONSTRAINT engine_engine_code_key UNIQUE (engine_code);
    END IF;
END$$;

-- 2. vehicle_engine_fitment: which models used which engines, and when.
CREATE TABLE IF NOT EXISTS public.vehicle_engine_fitment (
    id serial PRIMARY KEY,
    model_id integer NOT NULL REFERENCES public.vehicle_model(model_id) ON DELETE CASCADE,
    engine_id integer NOT NULL REFERENCES public.engine(engine_id) ON DELETE CASCADE,
    year_start integer,
    year_end integer,
    UNIQUE (model_id, engine_id)
);

-- 3. One-time transform of the legacy per-model vehicle_engine table, if it
--    still exists (skipped harmlessly on a re-run or a fresh DB that never had it).
DO $$
DECLARE
    rec RECORD;
    v_engine_id integer;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vehicle_engine') THEN
        CREATE TEMP TABLE IF NOT EXISTS _engine_migration_map (
            old_engine_id integer PRIMARY KEY,
            new_engine_id integer NOT NULL
        ) ON COMMIT DROP;

        FOR rec IN
            SELECT engine_id, model_id, engine_name
            FROM public.vehicle_engine
            WHERE engine_name IS NOT NULL AND trim(engine_name) <> ''
        LOOP
            SELECT engine_id INTO v_engine_id
            FROM public.engine
            WHERE lower(trim(engine_code)) = lower(trim(rec.engine_name));

            IF v_engine_id IS NULL THEN
                INSERT INTO public.engine (engine_code) VALUES (trim(rec.engine_name))
                RETURNING engine_id INTO v_engine_id;
            END IF;

            INSERT INTO _engine_migration_map (old_engine_id, new_engine_id)
                VALUES (rec.engine_id, v_engine_id)
                ON CONFLICT (old_engine_id) DO NOTHING;

            INSERT INTO public.vehicle_engine_fitment (model_id, engine_id)
                VALUES (rec.model_id, v_engine_id)
                ON CONFLICT (model_id, engine_id) DO NOTHING;
        END LOOP;

        -- Repoint application.engine_id at the new global engine table.
        UPDATE public.application a
        SET engine_id = m.new_engine_id
        FROM _engine_migration_map m
        WHERE a.engine_id = m.old_engine_id;
    END IF;
END$$;

-- 4. Repoint application.engine_id's FK from vehicle_engine to the new engine table.
DROP VIEW IF EXISTS public.application_view;
ALTER TABLE public.application DROP CONSTRAINT IF EXISTS application_engine_id_fkey;
ALTER TABLE public.application
    ADD CONSTRAINT application_engine_id_fkey FOREIGN KEY (engine_id) REFERENCES public.engine(engine_id) ON DELETE SET NULL;

-- 5. Drop the now-superseded legacy per-model engine table.
DROP TABLE IF EXISTS public.vehicle_engine;

-- 6. Recreate application_view against the new engine table.
CREATE OR REPLACE VIEW public.application_view AS
SELECT a.application_id,
       a.make_id,
       a.model_id,
       a.engine_id,
       vmk.make_name AS make,
       vmd.model_name AS model,
       eng.engine_code AS engine
FROM public.application a
LEFT JOIN public.vehicle_make vmk ON a.make_id = vmk.make_id
LEFT JOIN public.vehicle_model vmd ON a.model_id = vmd.model_id
LEFT JOIN public.engine eng ON a.engine_id = eng.engine_id;

-- 7. Allow partial fitment specificity: at least one of make/model/engine must
--    be set, but any combination is valid (e.g. engine-only fitment for "any
--    vehicle with a 4D56").
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'application_at_least_one_dimension_chk'
    ) THEN
        ALTER TABLE public.application
            ADD CONSTRAINT application_at_least_one_dimension_chk
            CHECK (make_id IS NOT NULL OR model_id IS NOT NULL OR engine_id IS NOT NULL);
    END IF;
END$$;

-- Replace the single UNIQUE(make_id, model_id, engine_id) constraint with
-- partial unique indexes, one per specificity tier, so NULL dimensions don't
-- silently allow duplicates within that tier.
ALTER TABLE public.application DROP CONSTRAINT IF EXISTS unique_application_make_model_engine;

CREATE UNIQUE INDEX IF NOT EXISTS application_full_unique_idx
    ON public.application (make_id, model_id, engine_id)
    WHERE make_id IS NOT NULL AND model_id IS NOT NULL AND engine_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS application_make_model_unique_idx
    ON public.application (make_id, model_id)
    WHERE make_id IS NOT NULL AND model_id IS NOT NULL AND engine_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS application_make_engine_unique_idx
    ON public.application (make_id, engine_id)
    WHERE make_id IS NOT NULL AND engine_id IS NOT NULL AND model_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS application_model_engine_unique_idx
    ON public.application (model_id, engine_id)
    WHERE model_id IS NOT NULL AND engine_id IS NOT NULL AND make_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS application_make_only_unique_idx
    ON public.application (make_id)
    WHERE make_id IS NOT NULL AND model_id IS NULL AND engine_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS application_model_only_unique_idx
    ON public.application (model_id)
    WHERE model_id IS NOT NULL AND make_id IS NULL AND engine_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS application_engine_only_unique_idx
    ON public.application (engine_id)
    WHERE engine_id IS NOT NULL AND make_id IS NULL AND model_id IS NULL;

-- 8. Universal parts (e.g. generic hose clamps) skip fitment entirely.
ALTER TABLE public.part ADD COLUMN IF NOT EXISTS is_universal boolean NOT NULL DEFAULT false;

COMMIT;
