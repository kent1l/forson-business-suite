-- Migration: Split application into vehicle_make, vehicle_model, vehicle_engine
-- 2025-08-27

BEGIN;

-- Create new tables (if not exist)
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

-- Ensure application table exists with new columns
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='application' AND column_name='make_id') THEN
        ALTER TABLE public.application ADD COLUMN make_id integer;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='application' AND column_name='model_id') THEN
        ALTER TABLE public.application ADD COLUMN model_id integer;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='application' AND column_name='engine_id') THEN
        ALTER TABLE public.application ADD COLUMN engine_id integer;
    END IF;
END$$;

-- Migrate existing string entries from previous schema if any (make, model, engine columns)
-- We assume old application table had columns make, model, engine. If present, migrate their data.
DO $$
DECLARE
    rec RECORD;
    v_make_id integer;
    v_model_id integer;
    v_engine_id integer;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='application' AND column_name='make') THEN
        FOR rec IN SELECT application_id, make, model, engine FROM public.application LOOP
            -- Insert or get make
            IF rec.make IS NOT NULL THEN
                INSERT INTO public.vehicle_make (make_name)
                VALUES (rec.make)
                ON CONFLICT (make_name) DO NOTHING;
                SELECT make_id INTO v_make_id FROM public.vehicle_make WHERE make_name = rec.make;
            ELSE
                v_make_id := NULL;
            END IF;

            -- Insert or get model
            IF rec.model IS NOT NULL AND v_make_id IS NOT NULL THEN
                INSERT INTO public.vehicle_model (make_id, model_name)
                VALUES (v_make_id, rec.model)
                ON CONFLICT (make_id, model_name) DO NOTHING;
                SELECT model_id INTO v_model_id FROM public.vehicle_model WHERE make_id = v_make_id AND model_name = rec.model;
            ELSE
                v_model_id := NULL;
            END IF;

            -- Insert or get engine
            IF rec.engine IS NOT NULL AND v_model_id IS NOT NULL THEN
                INSERT INTO public.vehicle_engine (model_id, engine_name)
                VALUES (v_model_id, rec.engine)
                ON CONFLICT (model_id, engine_name) DO NOTHING;
                SELECT engine_id INTO v_engine_id FROM public.vehicle_engine WHERE model_id = v_model_id AND engine_name = rec.engine;
            ELSE
                v_engine_id := NULL;
            END IF;

            -- Update application to reference new ids
            UPDATE public.application SET make_id = v_make_id, model_id = v_model_id, engine_id = v_engine_id WHERE application_id = rec.application_id;
        END LOOP;

        -- Optional: keep old text columns for backward-compatibility, or drop them if desired.
    END IF;
END$$;

-- Adjust part_application foreign key to reference application table remains unchanged.
-- Create foreign key constraints for the new application columns
ALTER TABLE public.application
    DROP CONSTRAINT IF EXISTS application_make_id_fkey,
    DROP CONSTRAINT IF EXISTS application_model_id_fkey,
    DROP CONSTRAINT IF EXISTS application_engine_id_fkey;

ALTER TABLE public.application
    ADD CONSTRAINT application_make_id_fkey FOREIGN KEY (make_id) REFERENCES public.vehicle_make(make_id) ON DELETE SET NULL;

ALTER TABLE public.application
    ADD CONSTRAINT application_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.vehicle_model(model_id) ON DELETE SET NULL;

ALTER TABLE public.application
    ADD CONSTRAINT application_engine_id_fkey FOREIGN KEY (engine_id) REFERENCES public.vehicle_engine(engine_id) ON DELETE SET NULL;

-- Add unique constraint for make/model/engine combination if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        WHERE tc.table_name = 'application' AND tc.constraint_type = 'UNIQUE' AND tc.constraint_name = 'unique_application_make_model_engine'
    ) THEN
        ALTER TABLE public.application
        ADD CONSTRAINT unique_application_make_model_engine UNIQUE (make_id, model_id, engine_id);
    END IF;
END$$;

-- Create compatibility view exposing application rows as strings
CREATE OR REPLACE VIEW public.application_view AS
SELECT a.application_id,
       vmk.make_name AS make,
       vmd.model_name AS model,
       veng.engine_name AS engine
FROM public.application a
LEFT JOIN public.vehicle_make vmk ON a.make_id = vmk.make_id
LEFT JOIN public.vehicle_model vmd ON a.model_id = vmd.model_id
LEFT JOIN public.vehicle_engine veng ON a.engine_id = veng.engine_id;

COMMIT;
