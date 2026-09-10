-- Migration: Display shorthand dictionary (Vehicle Fitment Phase 10)
-- See docs/plans/2026-09-10_fitment-parsing-linking-display.md §10a
--
-- Fitment lists are the densest text in the app -- they appear in POS search
-- suggestions, the parts table, purchase orders and invoicing, often inside a
-- 260px cell. Long canonical names dominate that space: "UD Trucks / Nissan
-- Diesel" is 25 characters before a single model is named.
--
-- `display_short` is a curated, preferred abbreviation for rendering ONLY. It is
-- deliberately NOT an alias: the alias tables from 20260910_02 map many input
-- spellings onto one canonical row (including typo variants nobody would ever
-- want displayed), and they run in the opposite direction. This column is
-- one-per-row, chosen for readability, and is never stored on a record, never
-- submitted, never exported, and never indexed into Meilisearch -- the search
-- index keeps full names so a search for "Mitsubishi" still matches.
--
-- Seeded only where the saving is meaningful (roughly 3+ characters) and the
-- short form is unambiguous in this market. THE SEEDED LIST IS BUSINESS
-- VOCABULARY AND SHOULD BE REVIEWED by someone who works the counter; anything
-- left NULL simply renders with its full name.
-- 2026-09-10

BEGIN;

ALTER TABLE public.vehicle_make  ADD COLUMN IF NOT EXISTS display_short text;
ALTER TABLE public.vehicle_model ADD COLUMN IF NOT EXISTS display_short text;
ALTER TABLE public.engine        ADD COLUMN IF NOT EXISTS display_short text;

-- Makes. Only the four names long enough to be worth shortening.
UPDATE public.vehicle_make SET display_short = v.short
FROM (VALUES
    ('UD Trucks / Nissan Diesel', 'UD'),
    ('Mitsubishi Fuso',           'Fuso'),
    ('Mitsubishi',                'Mits'),
    ('Chevrolet',                 'Chev')
) AS v(full_name, short)
WHERE lower(trim(public.vehicle_make.make_name)) = lower(trim(v.full_name))
  AND public.vehicle_make.display_short IS DISTINCT FROM v.short;

-- Models. Where a model's common counter name is simply the distinctive part of
-- the official one ("Land Cruiser Prado" is universally "Prado"), that is used;
-- otherwise the head word is abbreviated rather than dropped, so the model stays
-- recognisable.
UPDATE public.vehicle_model SET display_short = v.short
FROM (VALUES
    ('700 Series (Profia)', '700 Profia'),
    ('300 Series (Dutro)',  '300 Dutro'),
    ('Land Cruiser Prado',  'Prado'),
    ('Land Cruiser',        'L.Cruiser'),
    ('Every / Multicab',    'Every'),
    ('Fuso Super Great',    'Super Great'),
    ('Fuso The Great',      'The Great'),
    ('View Traveller',      'View Trav.'),
    ('Montero Sport',       'Montero Sp.'),
    ('Corolla Altis',       'Altis'),
    ('Corolla Cross',       'C.Cross'),
    ('Grand Starex',        'G.Starex'),
    ('Trailblazer',         'T.blazer'),
    ('K2500 Karga',         'K2500'),
    ('Tamaraw FX',          'Tamaraw')
) AS v(full_name, short)
WHERE lower(trim(public.vehicle_model.model_name)) = lower(trim(v.full_name))
  AND public.vehicle_model.display_short IS DISTINCT FROM v.short;

-- Engines. Descriptive marketing names rather than codes are the only ones worth
-- shortening; real codes are already short and must never be altered.
UPDATE public.engine SET display_short = v.short
FROM (VALUES
    ('EcoBlue 2.0 Single-Turbo',    'EcoBlue 2.0 ST'),
    ('EcoBlue 2.0 Bi-Turbo',        'EcoBlue 2.0 BT'),
    ('BYD476ZQC + Dual Motors',     'BYD476ZQC+DM'),
    ('Cummins ISF 2.8',             'ISF 2.8'),
    ('Cummins ISF 3.8',             'ISF 3.8')
) AS v(full_name, short)
WHERE lower(trim(public.engine.engine_code)) = lower(trim(v.full_name))
  AND public.engine.display_short IS DISTINCT FROM v.short;

COMMIT;
