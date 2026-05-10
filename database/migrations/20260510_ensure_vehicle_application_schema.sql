-- Migration: Ensure complete vehicle application schema exists
-- This fixes the production gap where these tables were missing.
BEGIN;

CREATE TABLE IF NOT EXISTS public.vehicle_make (
    make_id serial PRIMARY KEY,
    make_name character varying(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public.vehicle_model (
    model_id serial PRIMARY KEY,
    make_id integer NOT NULL REFERENCES public.vehicle_make(make_id) ON DELETE CASCADE,
    model_name character varying(100) NOT NULL,
    UNIQUE (make_id, model_name)
);

CREATE TABLE IF NOT EXISTS public.vehicle_engine (
    engine_id serial PRIMARY KEY,
    model_id integer NOT NULL REFERENCES public.vehicle_model(model_id) ON DELETE CASCADE,
    engine_name character varying(100),
    UNIQUE (model_id, engine_name)
);

CREATE TABLE IF NOT EXISTS public.application (
    application_id serial PRIMARY KEY,
    make_id integer REFERENCES public.vehicle_make(make_id) ON DELETE SET NULL,
    model_id integer REFERENCES public.vehicle_model(model_id) ON DELETE SET NULL,
    engine_id integer REFERENCES public.vehicle_engine(engine_id) ON DELETE SET NULL,
    CONSTRAINT unique_application_make_model_engine UNIQUE (make_id, model_id, engine_id)
);

CREATE TABLE IF NOT EXISTS public.part_application (
    part_app_id serial PRIMARY KEY,
    part_id integer NOT NULL REFERENCES public.part(part_id) ON DELETE CASCADE,
    application_id integer NOT NULL REFERENCES public.application(application_id) ON DELETE CASCADE,
    year_start integer,
    year_end integer,
    UNIQUE (part_id, application_id)
);

COMMIT;
