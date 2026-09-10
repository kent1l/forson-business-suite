-- Migration: Split slash-compressed engine "family" rows into atomic engines
-- (Vehicle Fitment Phase 6a -- see docs/plans/2026-09-10_fitment-parsing-linking-display.md)
--
-- Staff write engine codes in compressed shorthand ("4D55/6", "4D55/56/65").
-- One legacy row stored that shorthand verbatim as a single engine, which
-- asserts something untrue: a part that fits a 4D55 does not necessarily fit a
-- 4D56 or a 4D65. Left in place, a part recorded as "fits 4D55" would silently
-- claim it fits all three, and there would be no way to correct one member
-- without unpicking the merged row.
--
-- The decision (PRD-FBS-FIT-002 §3, decision 2) is that engines are stored
-- ATOMICALLY and linked to parts individually. Combining similar codes back
-- into "4D55/56" for readability is a frontend display concern only
-- (packages/web/src/utils/engineCodeFormat.js) and never re-enters the schema.
--
-- Verified on the dev database before writing this migration: the only
-- slash-coded row was `4D55/56/65` (engine_id 8) with 1 application and 0
-- part_application links, so no part fitment data is at risk here. The
-- fan-out below is nevertheless written generically -- it copies any
-- part_application links across to every member engine -- so it stays correct
-- on a production database where those links may exist.
-- 2026-09-10

BEGIN;

-- 1. Declare the family memberships to split. Adding a row here is all that a
--    future family split needs; everything below is generic.
CREATE TEMP TABLE _engine_family_split (
    family_code text NOT NULL,
    member_code text NOT NULL
) ON COMMIT DROP;

INSERT INTO _engine_family_split (family_code, member_code) VALUES
    ('4D55/56/65', '4D55'),
    ('4D55/56/65', '4D56'),
    ('4D55/56/65', '4D65');

-- 2. Ensure every member exists as its own engine row (case-insensitive skip if
--    already present -- 4D56 already existed as engine_id 61 on the dev DB).
--    fuel_type is safe to assert for this family (the whole 4D5x/4D6x line is
--    diesel); displacement is deliberately left NULL for newly created rows
--    rather than guessed, matching the precedent set in
--    20260909_05_engine_displacement_fuel_type.sql.
INSERT INTO public.engine (engine_code, fuel_type)
SELECT DISTINCT s.member_code, 'diesel'
FROM _engine_family_split s
WHERE NOT EXISTS (
    SELECT 1 FROM public.engine e WHERE lower(trim(e.engine_code)) = lower(trim(s.member_code))
);

-- 3. Displacement is deliberately NOT copied from the family row onto its
--    members. The merged row carried 2.50L, but that figure only describes the
--    4D56 -- the 4D55 and 4D65 are different capacities -- so propagating it
--    would replace one wrong assertion with three. Only the member the figure
--    genuinely belongs to is backfilled, and the others are left NULL for
--    someone with the reference data to fill in, exactly as
--    20260909_05_engine_displacement_fuel_type.sql did for the engines it could
--    not confidently identify.
UPDATE public.engine SET displacement_liters = 2.50
WHERE lower(trim(engine_code)) = '4d56' AND displacement_liters IS NULL;

-- 4. Resolve the declared codes to ids.
CREATE TEMP TABLE _engine_family_map ON COMMIT DROP AS
SELECT f.engine_id AS family_engine_id, m.engine_id AS member_engine_id
FROM _engine_family_split s
JOIN public.engine f ON lower(trim(f.engine_code)) = lower(trim(s.family_code))
JOIN public.engine m ON lower(trim(m.engine_code)) = lower(trim(s.member_code));

-- 5. Fan every application that referenced a family row out to one application
--    per member engine, preserving make/model. ON CONFLICT DO NOTHING respects
--    the per-specificity-tier partial unique indexes from 20260909_02.
INSERT INTO public.application (make_id, model_id, engine_id)
SELECT DISTINCT a.make_id, a.model_id, fm.member_engine_id
FROM public.application a
JOIN _engine_family_map fm ON fm.family_engine_id = a.engine_id
ON CONFLICT DO NOTHING;

-- 6. Fan the part links out to the newly created member applications, keeping
--    each link's own year range. A part previously recorded against the family
--    row genuinely was entered as "fits this whole family", so copying it to
--    every member is the honest reading of the original intent.
INSERT INTO public.part_application (part_id, application_id, year_start, year_end)
SELECT DISTINCT pa.part_id, member_app.application_id, pa.year_start, pa.year_end
FROM public.part_application pa
JOIN public.application family_app ON family_app.application_id = pa.application_id
JOIN _engine_family_map fm ON fm.family_engine_id = family_app.engine_id
JOIN public.application member_app
     ON member_app.engine_id = fm.member_engine_id
    AND member_app.make_id IS NOT DISTINCT FROM family_app.make_id
    AND member_app.model_id IS NOT DISTINCT FROM family_app.model_id
ON CONFLICT (part_id, application_id) DO NOTHING;

-- 7. Drop the family applications (part_application cascades) and the family
--    engine rows themselves.
DELETE FROM public.application a
USING _engine_family_map fm
WHERE a.engine_id = fm.family_engine_id;

DELETE FROM public.engine e
USING (SELECT DISTINCT family_engine_id FROM _engine_family_map) fm
WHERE e.engine_id = fm.family_engine_id;

-- 8. Prevent reintroduction. No legitimate engine code among the 271 seeded in
--    20260909_07 contains a slash, so this is safe to enforce outright -- and
--    it is what keeps the atomic-storage decision from silently eroding as new
--    engines are added through the taxonomy UI.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'engine_code_no_slash_chk'
    ) THEN
        ALTER TABLE public.engine
            ADD CONSTRAINT engine_code_no_slash_chk
            CHECK (engine_code !~ '/');
    END IF;
END$$;

COMMIT;
