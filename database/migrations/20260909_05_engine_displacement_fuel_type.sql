-- Migration: Engine displacement + fuel type (Vehicle Fitment Phase 1a)
-- Displacement and fuel type are not just a naming-duplication cleanup -- they're
-- an independently useful search/filter dimension in retail aftermarket parts
-- (fuel type is often asked before make/model; displacement is the common
-- fallback when the exact engine code isn't known). The business's own existing
-- engine data already has bare-displacement rows ("1.2", "1.5") with no real
-- code, confirming this pattern already happens informally.
-- 2026-09-09

BEGIN;

ALTER TABLE public.engine ADD COLUMN IF NOT EXISTS displacement_liters numeric(4,2);
ALTER TABLE public.engine ADD COLUMN IF NOT EXISTS fuel_type text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'engine_fuel_type_chk'
    ) THEN
        ALTER TABLE public.engine
            ADD CONSTRAINT engine_fuel_type_chk
            CHECK (fuel_type IS NULL OR fuel_type IN ('diesel', 'gasoline', 'hybrid', 'mild_hybrid', 'electric', 'other'));
    END IF;
END$$;

-- Backfill only where confidently known -- either an exact/near-exact code match
-- against the user-provided reference list (see the Phase 1b seed migration), or
-- an unambiguous informal short-form of a well-established code already linked
-- to the same vehicle model in this database. Left NULL wherever genuinely
-- uncertain rather than guessed (5 of 12 existing engines: 6D20, SD22, 4GE1,
-- KC2700, ITR -- none had a confident cross-reference).
UPDATE public.engine SET displacement_liters = 2.4, fuel_type = 'diesel' WHERE engine_code = 'C240';
UPDATE public.engine SET displacement_liters = 1.2, fuel_type = 'gasoline' WHERE engine_code = '1.2';
UPDATE public.engine SET displacement_liters = 0.66, fuel_type = 'gasoline' WHERE engine_code = 'F6A';
UPDATE public.engine SET displacement_liters = 2.5, fuel_type = 'diesel' WHERE engine_code = '4D55/56/65';
UPDATE public.engine SET displacement_liters = 2.0, fuel_type = 'gasoline' WHERE engine_code = '1TR';
UPDATE public.engine SET displacement_liters = 1.3, fuel_type = 'gasoline' WHERE engine_code = '1NRFE';
UPDATE public.engine SET displacement_liters = 1.5, fuel_type = 'gasoline' WHERE engine_code = '1.5';

COMMIT;
