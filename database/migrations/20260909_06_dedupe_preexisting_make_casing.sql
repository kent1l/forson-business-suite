-- Migration: Consolidate pre-existing duplicate-casing vehicle_make rows
-- (Vehicle Fitment Phase 1b prep)
--
-- Before the Phase 3 case-insensitive normalization shipped, the taxonomy had
-- already accumulated case-variant duplicates for the same make: "Toyota"(2) vs
-- "TOYOTA"(12), "Isuzu"(23) vs "ISUZU"(3), and "KIA "(10, trailing space) vs
-- "KIA"(22) -- each pair with real, separately-linked models and parts. Loading
-- the new taxonomy seed data (Phase 1b) under the canonical casing would only
-- widen this fragmentation, so this is fixed first: each duplicate's one model
-- is reassigned to the canonical make (no model-name collisions), any
-- `application` row pointing at the old make_id directly is repointed, and the
-- now-empty duplicate make row is removed. This is a narrow, one-time fix for
-- these 3 known duplicates -- not the general taxonomy merge tool (still
-- deferred), which would handle arbitrary future duplicates via an admin UI.
-- 2026-09-09

BEGIN;

-- Toyota(2) -> TOYOTA(12)
UPDATE public.vehicle_model SET make_id = 12 WHERE make_id = 2;
UPDATE public.application SET make_id = 12 WHERE make_id = 2;
DELETE FROM public.vehicle_make WHERE make_id = 2;

-- Isuzu(23) -> ISUZU(3)
UPDATE public.vehicle_model SET make_id = 3 WHERE make_id = 23;
UPDATE public.application SET make_id = 3 WHERE make_id = 23;
DELETE FROM public.vehicle_make WHERE make_id = 23;

-- "KIA "(10, trailing space) -> KIA(22)
UPDATE public.vehicle_model SET make_id = 22 WHERE make_id = 10;
UPDATE public.application SET make_id = 22 WHERE make_id = 10;
DELETE FROM public.vehicle_make WHERE make_id = 10;

COMMIT;
