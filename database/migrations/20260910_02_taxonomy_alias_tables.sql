-- Migration: Make / model / engine alias tables (Vehicle Fitment Phase 6b)
-- See docs/plans/2026-09-10_fitment-parsing-linking-display.md §6.2
--
-- Staff type market shorthand ("Mits", "Chevy", "Fuso") and compressed or
-- informal engine codes that are not the canonical taxonomy name. Today every
-- such input has to go to the LLM parser, which reloads the entire taxonomy
-- into its prompt to resolve it. An alias is the cheap, deterministic, and
-- permanent answer: once a human has confirmed that a given raw string means a
-- given taxonomy row, that mapping never needs a model again.
--
-- alias_text is stored NORMALIZED (uppercased, whitespace collapsed) by the
-- application layer -- see packages/api/helpers/engineCodeGrammar.js
-- normalizeAlias() -- so lookup is a plain exact hit rather than a scan.
--
-- `source` separates curated seed aliases from ones learned by observing staff
-- accept a parser suggestion (Phase 8.3), so a bad learned alias can be pruned
-- in bulk without disturbing the curated set.
-- 2026-09-10

BEGIN;

CREATE TABLE IF NOT EXISTS public.vehicle_make_alias (
    alias_id serial PRIMARY KEY,
    make_id integer NOT NULL REFERENCES public.vehicle_make(make_id) ON DELETE CASCADE,
    alias_text text NOT NULL,
    source text NOT NULL DEFAULT 'seed',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT vehicle_make_alias_source_chk CHECK (source IN ('seed', 'learned'))
);

CREATE TABLE IF NOT EXISTS public.vehicle_model_alias (
    alias_id serial PRIMARY KEY,
    model_id integer NOT NULL REFERENCES public.vehicle_model(model_id) ON DELETE CASCADE,
    alias_text text NOT NULL,
    source text NOT NULL DEFAULT 'seed',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT vehicle_model_alias_source_chk CHECK (source IN ('seed', 'learned'))
);

CREATE TABLE IF NOT EXISTS public.engine_alias (
    alias_id serial PRIMARY KEY,
    engine_id integer NOT NULL REFERENCES public.engine(engine_id) ON DELETE CASCADE,
    alias_text text NOT NULL,
    source text NOT NULL DEFAULT 'seed',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT engine_alias_source_chk CHECK (source IN ('seed', 'learned'))
);

-- An alias string is unique per table, but NOT globally unique across a table's
-- target: one alias resolves to exactly one make/model, whereas an engine alias
-- may legitimately fan out to several engines (the split family "4D55/56/65"
-- means all three of its members), so engine_alias is unique on the pair.
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_make_alias_text_unique_idx
    ON public.vehicle_make_alias (upper(alias_text));
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_model_alias_text_unique_idx
    ON public.vehicle_model_alias (upper(alias_text));
CREATE UNIQUE INDEX IF NOT EXISTS engine_alias_text_engine_unique_idx
    ON public.engine_alias (upper(alias_text), engine_id);

CREATE INDEX IF NOT EXISTS engine_alias_text_idx ON public.engine_alias (upper(alias_text));

-- Seed: market shorthand for makes. Purely additive and idempotent; skipped
-- where the make doesn't exist or the alias is already recorded.
INSERT INTO public.vehicle_make_alias (make_id, alias_text, source)
SELECT mk.make_id, v.alias_text, 'seed'
FROM (VALUES
    ('MITS',            'Mitsubishi'),
    ('MITSU',           'Mitsubishi'),
    ('CHEVY',           'Chevrolet'),
    ('FUSO',            'Mitsubishi Fuso'),
    ('UD',              'UD Trucks / Nissan Diesel'),
    ('NISSAN DIESEL',   'UD Trucks / Nissan Diesel'),
    ('TOY',             'Toyota'),
    ('MITSUBISHI MOTORS', 'Mitsubishi')
) AS v(alias_text, make_name)
JOIN public.vehicle_make mk ON lower(trim(mk.make_name)) = lower(trim(v.make_name))
WHERE NOT EXISTS (
    SELECT 1 FROM public.vehicle_make_alias a WHERE upper(a.alias_text) = upper(v.alias_text)
);

-- Seed: the split engine family from 20260910_01 keeps resolving from its old
-- compressed form, fanning out to all three member engines.
INSERT INTO public.engine_alias (engine_id, alias_text, source)
SELECT e.engine_id, v.alias_text, 'seed'
FROM (VALUES
    ('4D55/56/65', '4D55'),
    ('4D55/56/65', '4D56'),
    ('4D55/56/65', '4D65')
) AS v(alias_text, engine_code)
JOIN public.engine e ON lower(trim(e.engine_code)) = lower(trim(v.engine_code))
WHERE NOT EXISTS (
    SELECT 1 FROM public.engine_alias a
    WHERE upper(a.alias_text) = upper(v.alias_text) AND a.engine_id = e.engine_id
);

COMMIT;
